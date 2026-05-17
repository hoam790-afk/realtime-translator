const form = document.querySelector("#settings-form");
const connectButton = document.querySelector("#connect-button");
const stopButton = document.querySelector("#stop-button");
const sourceLanguage = document.querySelector("#source-language");
const targetLanguage = document.querySelector("#target-language");
const voice = document.querySelector("#voice");
const statusDot = document.querySelector("#status-dot");
const statusText = document.querySelector("#status-text");
const micState = document.querySelector("#mic-state");
const latencyState = document.querySelector("#latency-state");
const sourceLog = document.querySelector("#source-log");
const translationLog = document.querySelector("#translation-log");
const remoteAudio = document.querySelector("#remote-audio");

let peerConnection;
let dataChannel;
let localStream;
let currentResponseMessage;

function setStatus(label, state = "idle") {
  statusText.textContent = label;
  statusDot.className = `status-dot ${state === "live" ? "live" : ""} ${state === "error" ? "error" : ""}`;
}

function clearEmpty(container) {
  const empty = container.querySelector(".empty");
  if (empty) empty.remove();
}

function appendMessage(container, text = "") {
  clearEmpty(container);
  const message = document.createElement("p");
  message.className = "message";
  message.textContent = text;
  container.append(message);
  container.scrollTop = container.scrollHeight;
  return message;
}

function appendDelta(container, delta) {
  if (!currentResponseMessage || !container.contains(currentResponseMessage)) {
    currentResponseMessage = appendMessage(container);
  }
  currentResponseMessage.textContent += delta;
  container.scrollTop = container.scrollHeight;
}

function selectedMode() {
  return new FormData(form).get("mode") || "speech";
}

async function getClientSecret() {
  const response = await fetch("/api/realtime/client-secret", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sourceLanguage: sourceLanguage.value,
      targetLanguage: targetLanguage.value,
      voice: voice.value,
      mode: selectedMode()
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Không tạo được client secret.");
  }

  return data.value || data.client_secret?.value || data.client_secret;
}

async function connectRealtime(event) {
  event.preventDefault();
  connectButton.disabled = true;
  stopButton.disabled = false;
  setStatus("Đang xin quyền mic...");

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        "Trình duyệt hiện tại không hỗ trợ micro cho trang này. Hãy mở bằng Chrome/Edge trên máy tính tại http://localhost:3000, hoặc dùng link HTTPS khi mở trên điện thoại."
      );
    }

    localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    micState.textContent = "Mic đang bật";

    setStatus("Đang tạo phiên...");
    const clientSecret = await getClientSecret();
    if (!clientSecret) throw new Error("Phản hồi OpenAI không có client secret.");

    peerConnection = new RTCPeerConnection();
    peerConnection.ontrack = (event) => {
      remoteAudio.srcObject = event.streams[0];
    };
    peerConnection.onconnectionstatechange = () => {
      latencyState.textContent = peerConnection.connectionState;
      if (peerConnection.connectionState === "connected") setStatus("Đang dịch realtime", "live");
      if (["failed", "disconnected", "closed"].includes(peerConnection.connectionState)) {
        setStatus("Đã ngắt kết nối");
      }
    };

    localStream.getAudioTracks().forEach((track) => {
      peerConnection.addTrack(track, localStream);
    });

    dataChannel = peerConnection.createDataChannel("oai-events");
    dataChannel.onopen = () => {
      setStatus("Đang dịch realtime", "live");
    };
    dataChannel.onmessage = (event) => handleRealtimeEvent(JSON.parse(event.data));

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    const formData = new FormData();
    formData.append("sdp", offer.sdp);
    formData.append(
      "session",
      JSON.stringify({
        type: "realtime",
        model: "gpt-realtime"
      })
    );

    const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: { authorization: `Bearer ${clientSecret}` },
      body: formData
    });

    if (!sdpResponse.ok) {
      const errorText = await sdpResponse.text();
      throw new Error(errorText || "Không kết nối được Realtime WebRTC.");
    }

    await peerConnection.setRemoteDescription({
      type: "answer",
      sdp: await sdpResponse.text()
    });
  } catch (error) {
    setStatus("Lỗi kết nối", "error");
    appendMessage(translationLog, error.message);
    stopRealtime();
  }
}

function sendResponseRequest() {
  if (!dataChannel || dataChannel.readyState !== "open") return;
  dataChannel.send(
    JSON.stringify({
      type: "response.create",
      response: {
        modalities: selectedMode() === "captions" ? ["text"] : ["audio", "text"]
      }
    })
  );
}

function handleRealtimeEvent(event) {
  switch (event.type) {
    case "conversation.item.input_audio_transcription.completed":
      appendMessage(sourceLog, event.transcript || "");
      break;
    case "input_audio_buffer.committed":
      sendResponseRequest();
      break;
    case "response.audio_transcript.delta":
    case "response.text.delta":
      appendDelta(translationLog, event.delta || "");
      break;
    case "response.audio_transcript.done":
    case "response.text.done":
    case "response.done":
      currentResponseMessage = null;
      break;
    case "error":
      appendMessage(translationLog, event.error?.message || "Realtime error.");
      setStatus("Lỗi từ Realtime", "error");
      break;
    default:
      break;
  }
}

function stopRealtime() {
  if (dataChannel) dataChannel.close();
  if (peerConnection) peerConnection.close();
  if (localStream) localStream.getTracks().forEach((track) => track.stop());

  dataChannel = null;
  peerConnection = null;
  localStream = null;
  currentResponseMessage = null;
  remoteAudio.srcObject = null;

  micState.textContent = "Mic tắt";
  latencyState.textContent = "Realtime";
  connectButton.disabled = false;
  stopButton.disabled = true;
  if (!statusDot.classList.contains("error")) setStatus("Đã dừng");
}

form.addEventListener("submit", connectRealtime);
stopButton.addEventListener("click", stopRealtime);
