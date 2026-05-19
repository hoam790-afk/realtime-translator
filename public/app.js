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
  if (!container.currentMessage || !container.contains(container.currentMessage)) {
    container.currentMessage = appendMessage(container);
  }
  container.currentMessage.textContent += delta;
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
    throw new Error(data.error || "Could not create a translation client secret.");
  }

  return data.value || data.client_secret?.value || data.client_secret;
}

async function connectRealtime(event) {
  event.preventDefault();
  connectButton.disabled = true;
  stopButton.disabled = false;
  setStatus("Dang xin quyen mic...");

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Browser does not allow microphone access for this page. Open the HTTPS link in Safari or Chrome.");
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
    if (!clientSecret) throw new Error("OpenAI did not return a client secret.");

    peerConnection = new RTCPeerConnection();
    peerConnection.ontrack = (event) => {
      remoteAudio.srcObject = event.streams[0];
      remoteAudio.play().catch(() => {
        appendMessage(translationLog, "Tap the page once if iOS blocks audio playback.");
      });
    };
    peerConnection.onconnectionstatechange = () => {
      latencyState.textContent = peerConnection.connectionState;
      if (peerConnection.connectionState === "connected") setStatus("Dang dich realtime", "live");
      if (["failed", "disconnected", "closed"].includes(peerConnection.connectionState)) {
        setStatus("Da ngat ket noi");
      }
    };

    localStream.getAudioTracks().forEach((track) => {
      peerConnection.addTrack(track, localStream);
    });

    dataChannel = peerConnection.createDataChannel("oai-events");
    dataChannel.onopen = () => {
      setStatus("Dang dich realtime", "live");
    };
    dataChannel.onmessage = (event) => handleRealtimeEvent(JSON.parse(event.data));

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
      throw new Error(errorText || "Could not connect to Realtime Translation WebRTC.");
    }

    await peerConnection.setRemoteDescription({
      type: "answer",
      sdp: await sdpResponse.text()
    });
  } catch (error) {
    setStatus("Loi ket noi", "error");
    appendMessage(translationLog, error.message);
    stopRealtime();
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
      sourceLog.currentMessage = null;
      break;
    case "session.output_transcript.done":
      translationLog.currentMessage = null;
      break;
    case "error":
      appendMessage(translationLog, event.error?.message || "Realtime error.");
      setStatus("Loi tu Realtime", "error");
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
  sourceLog.currentMessage = null;
  translationLog.currentMessage = null;
  remoteAudio.srcObject = null;

  micState.textContent = "Mic tat";
  latencyState.textContent = "Realtime";
  connectButton.disabled = false;
  stopButton.disabled = true;
  if (!statusDot.classList.contains("error")) setStatus("Da dung");
}

form.addEventListener("submit", connectRealtime);
stopButton.addEventListener("click", stopRealtime);
