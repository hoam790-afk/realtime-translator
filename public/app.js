const form = document.querySelector("#settings-form");
const connectButton = document.querySelector("#connect-button");
const stopButton = document.querySelector("#stop-button");
const sourceLanguage = document.querySelector("#source-language");
const targetLanguage = document.querySelector("#target-language");
const domainMode = document.querySelector("#domain-mode");
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

function setStatus(label, state = "idle") {
  statusText.textContent = label;
  statusDot.className = `status-dot ${state === "live" ? "live" : ""} ${state === "error" ? "error" : ""}`;
}

function clearEmpty(container) {
  const empty = container.querySelector(".empty");
  if (empty) empty.remove();
}

function resetLog(container, emptyText) {
  container.replaceChildren();
  const empty = document.createElement("p");
  empty.className = "empty";
  empty.textContent = emptyText;
  container.append(empty);
  container.currentMessage = null;
  container.pendingDelta = "";
  container.flushHandle = null;
}

function appendMessage(container, text = "", className = "") {
  clearEmpty(container);
  const message = document.createElement("p");
  message.className = `message ${className}`.trim();
  message.textContent = text;
  container.append(message);
  container.scrollTop = container.scrollHeight;
  return message;
}

function ensureCurrentMessage(container) {
  if (!container.currentMessage || !container.contains(container.currentMessage)) {
    container.currentMessage = appendMessage(container);
  }
  return container.currentMessage;
}

function flushDelta(container) {
  container.flushHandle = null;
  if (!container.pendingDelta) return;

  const message = ensureCurrentMessage(container);
  message.textContent += container.pendingDelta;
  container.pendingDelta = "";
  container.scrollTop = container.scrollHeight;
}

function appendDelta(container, delta) {
  if (!delta) return;
  container.pendingDelta = `${container.pendingDelta || ""}${delta}`;

  if (!container.flushHandle) {
    container.flushHandle = requestAnimationFrame(() => flushDelta(container));
  }
}

function finishCurrentMessage(container) {
  if (container.flushHandle) {
    cancelAnimationFrame(container.flushHandle);
    flushDelta(container);
  }

  const message = container.currentMessage;
  if (message && !message.textContent.trim()) {
    message.remove();
  }
  container.currentMessage = null;
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
      domainMode: domainMode.value,
      mode: selectedMode()
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Khong tao duoc phien dich tu may chu.");
  }

  return data.value || data.client_secret?.value || data.client_secret;
}

async function connectRealtime(event) {
  event.preventDefault();
  connectButton.disabled = true;
  stopButton.disabled = false;
  resetLog(sourceLog, "Lich su cau noi nguon se xuat hien o day.");
  resetLog(translationLog, "Lich su ban dich se xuat hien khi ban noi.");
  setStatus("Dang xin quyen micro...");

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Trinh duyet khong cho phep dung micro. Hay mo link HTTPS bang Safari hoac Chrome.");
    }

    localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    micState.textContent = "Mic dang bat";

    setStatus("Dang tao phien dich...");
    const clientSecret = await getClientSecret();
    if (!clientSecret) throw new Error("OpenAI khong tra ve client secret.");

    peerConnection = new RTCPeerConnection();
    peerConnection.ontrack = (event) => {
      remoteAudio.srcObject = event.streams[0];
      remoteAudio.play().catch(() => {
        appendMessage(translationLog, "Neu iPhone chua phat tieng, hay cham vao man hinh mot lan roi noi lai.", "notice");
      });
    };
    peerConnection.onconnectionstatechange = () => {
      latencyState.textContent = peerConnection.connectionState;
      if (peerConnection.connectionState === "connected") setStatus("Dang phien dich", "live");
      if (peerConnection.connectionState === "failed") {
        setStatus("Mat ket noi", "error");
        appendMessage(translationLog, "Ket noi WebRTC bi loi. Bam Dung roi Bat dau de tao phien moi.", "error-message");
      }
      if (peerConnection.connectionState === "disconnected") setStatus("Dang ket noi lai...");
      if (peerConnection.connectionState === "closed" && localStream) setStatus("Da dung");
    };

    localStream.getAudioTracks().forEach((track) => {
      peerConnection.addTrack(track, localStream);
    });

    dataChannel = peerConnection.createDataChannel("oai-events");
    dataChannel.onopen = () => {
      setStatus("Dang phien dich", "live");
    };
    dataChannel.onmessage = (event) => handleRealtimeEvent(JSON.parse(event.data));
    dataChannel.onclose = () => {
      if (localStream) setStatus("Kenh dich tam ngat", "error");
    };

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    const sdpResponse = await fetch("https://api.openai.com/v1/realtime/translations/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${clientSecret}`,
        "Content-Type": "application/sdp"
      },
      body: offer.sdp
    });

    if (!sdpResponse.ok) {
      const errorText = await sdpResponse.text();
      throw new Error(errorText || "Khong ket noi duoc Realtime Translation WebRTC.");
    }

    await peerConnection.setRemoteDescription({
      type: "answer",
      sdp: await sdpResponse.text()
    });
  } catch (error) {
    setStatus("Loi ket noi", "error");
    appendMessage(translationLog, error.message, "error-message");
    stopRealtime({ keepError: true });
  }
}

function handleRealtimeEvent(event) {
  switch (event.type) {
    case "session.input_transcript.delta":
      appendDelta(sourceLog, event.delta || "");
      break;
    case "session.output_transcript.delta":
      appendDelta(translationLog, event.delta || "");
      break;
    case "session.input_transcript.done":
      finishCurrentMessage(sourceLog);
      break;
    case "session.output_transcript.done":
      finishCurrentMessage(translationLog);
      break;
    case "error":
      appendMessage(translationLog, event.error?.message || "Realtime error.", "error-message");
      setStatus("Loi tu Realtime", "error");
      break;
    default:
      break;
  }
}

function stopRealtime(options = {}) {
  if (dataChannel) dataChannel.close();
  if (peerConnection) peerConnection.close();
  if (localStream) localStream.getTracks().forEach((track) => track.stop());

  dataChannel = null;
  peerConnection = null;
  localStream = null;
  finishCurrentMessage(sourceLog);
  finishCurrentMessage(translationLog);
  remoteAudio.srcObject = null;

  micState.textContent = "Mic tat";
  latencyState.textContent = "Realtime";
  connectButton.disabled = false;
  stopButton.disabled = true;
  if (!options.keepError) setStatus("Da dung");
}

form.addEventListener("submit", connectRealtime);
stopButton.addEventListener("click", () => stopRealtime());
