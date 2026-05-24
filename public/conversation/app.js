const form = document.querySelector("#settings-form");
const connectButton = document.querySelector("#connect-button");
const stopButton = document.querySelector("#stop-button");
const myLanguage = document.querySelector("#my-language");
const partnerLanguage = document.querySelector("#partner-language");
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
let isRestarting = false;
let currentConversationId = null;
const clientTokenKey = "dml_client_token";

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

function normalizeText(text) {
  return text.replace(/\s+/g, " ").trim();
}

function pickMoreCompleteText(currentText, finalText) {
  const current = normalizeText(currentText || "");
  const final = normalizeText(finalText || "");
  if (!final) return current;
  if (!current) return final;

  const currentWords = current.split(/\s+/).filter(Boolean).length;
  const finalWords = final.split(/\s+/).filter(Boolean).length;
  return finalWords >= currentWords || final.length >= current.length ? final : current;
}

function textFromEvent(event) {
  if (!event) return "";
  if (typeof event.delta === "string") return event.delta;
  if (typeof event.transcript === "string") return event.transcript;
  if (typeof event.text === "string") return event.text;
  if (typeof event.output_text === "string") return event.output_text;
  if (typeof event.audio_transcript === "string") return event.audio_transcript;
  if (typeof event.input_audio_transcription?.text === "string") return event.input_audio_transcription.text;
  if (typeof event.input_audio_transcription?.transcript === "string") return event.input_audio_transcription.transcript;
  if (typeof event.item?.transcript === "string") return event.item.transcript;
  if (typeof event.item?.text === "string") return event.item.text;

  const content = event.item?.content || event.content;
  if (Array.isArray(content)) {
    return content
      .map((part) => part.transcript || part.text || "")
      .filter(Boolean)
      .join(" ");
  }

  return "";
}

function isInputTranscriptDelta(event) {
  const type = event.type || "";
  return type.includes("input") && type.includes("transcript") && type.includes("delta");
}

function isOutputTranscriptDelta(event) {
  const type = event.type || "";
  return (
    type.includes("delta") &&
    (
      type.includes("output_transcript") ||
      type.includes("audio_transcript") ||
      type.includes("output_text")
    )
  );
}

function isInputTranscriptFinal(event) {
  const type = event.type || "";
  return type.includes("input") && type.includes("transcript") && (
    type.includes("done") ||
    type.includes("completed") ||
    type.includes("final")
  );
}

function isOutputTranscriptFinal(event) {
  const type = event.type || "";
  return (
    (
      type.includes("output_transcript") ||
      type.includes("audio_transcript") ||
      type.includes("output_text")
    ) &&
    (
      type.includes("done") ||
      type.includes("completed") ||
      type.includes("final")
    )
  );
}

function finishCurrentMessage(container, finalText = "") {
  if (container.flushHandle) {
    cancelAnimationFrame(container.flushHandle);
    flushDelta(container);
  }

  const message = container.currentMessage;
  if (message) {
    message.textContent = pickMoreCompleteText(message.textContent, finalText);
    saveHistoryMessage(container === translationLog ? "translation" : "source", message.textContent);
  }

  if (message && !message.textContent.trim()) {
    message.remove();
  }
  container.currentMessage = null;
}

function selectedMode() {
  return new FormData(form).get("mode") || "speech";
}

function clientToken() {
  return localStorage.getItem(clientTokenKey);
}

async function historyApi(path, options = {}) {
  if (!clientToken()) return null;
  const headers = { "content-type": "application/json", ...(options.headers || {}) };
  headers.authorization = `Bearer ${clientToken()}`;
  const response = await fetch(path, { ...options, headers });
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

async function createHistorySession() {
  if (!clientToken()) return null;
  const data = await historyApi("/api/history", {
    method: "POST",
    body: JSON.stringify({
      mode: "conversation",
      title: "Hoi thoai tu dong",
      settings: {
        myLanguage: myLanguage.value,
        partnerLanguage: partnerLanguage.value,
        domainMode: domainMode.value,
        mode: selectedMode()
      }
    })
  });
  currentConversationId = data?.conversation?.id || null;
  return currentConversationId;
}

function saveHistoryMessage(role, text) {
  if (!currentConversationId || !text.trim()) return;
  historyApi(`/api/history/${currentConversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({ role, text })
  });
}

async function getClientSecret() {
  const response = await fetch("/api/realtime/conversation-client-secret", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      myLanguage: myLanguage.value,
      partnerLanguage: partnerLanguage.value,
      domainMode: domainMode.value,
      mode: selectedMode()
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Khong tao duoc phien hoi thoai tu may chu.");
  }

  return data.value || data.client_secret?.value || data.client_secret;
}

async function startRealtime(options = {}) {
  connectButton.disabled = true;
  stopButton.disabled = false;

  if (options.resetHistory !== false) {
    resetLog(sourceLog, "Lich su loi noi goc se xuat hien o day.");
    resetLog(translationLog, "App se tu dich sang ngon ngu con lai khi moi ben noi.");
    currentConversationId = null;
  }

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

    setStatus("Dang tao phien hoi thoai...");
    await createHistorySession();
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
      if (peerConnection.connectionState === "connected") setStatus("Dang hoi thoai", "live");
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
      setStatus("Dang hoi thoai", "live");
    };
    dataChannel.onmessage = (event) => handleRealtimeEvent(JSON.parse(event.data));
    dataChannel.onclose = () => {
      if (localStream) setStatus("Kenh hoi thoai tam ngat", "error");
    };

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${clientSecret}`,
        "Content-Type": "application/sdp"
      },
      body: offer.sdp
    });

    if (!sdpResponse.ok) {
      const errorText = await sdpResponse.text();
      throw new Error(errorText || "Khong ket noi duoc Realtime WebRTC.");
    }

    await peerConnection.setRemoteDescription({
      type: "answer",
      sdp: await sdpResponse.text()
    });
  } catch (error) {
    setStatus(`Loi ket noi: ${error.message.slice(0, 80)}`, "error");
    appendMessage(translationLog, error.message, "error-message");
    stopRealtime({ keepError: true });
  }
}

async function connectRealtime(event) {
  event.preventDefault();
  await startRealtime();
}

async function restartRealtimeForSettings() {
  if (!localStream || isRestarting) return;

  isRestarting = true;
  setStatus("Dang doi cau hinh...");
  appendMessage(translationLog, "Da doi ngon ngu hoi thoai. Dang tao lai phien...", "notice");
  stopRealtime({ keepError: true });
  await startRealtime({ resetHistory: false });
  isRestarting = false;
}

function handleRealtimeEvent(event) {
  if (isInputTranscriptDelta(event)) {
    appendDelta(sourceLog, textFromEvent(event));
    return;
  }

  if (isOutputTranscriptDelta(event)) {
    appendDelta(translationLog, textFromEvent(event));
    return;
  }

  if (isInputTranscriptFinal(event)) {
    finishCurrentMessage(sourceLog, textFromEvent(event));
    return;
  }

  if (isOutputTranscriptFinal(event)) {
    finishCurrentMessage(translationLog, textFromEvent(event));
    return;
  }

  if (event.type === "error") {
    appendMessage(translationLog, event.error?.message || "Realtime error.", "error-message");
    setStatus("Loi tu Realtime", "error");
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
myLanguage.addEventListener("change", restartRealtimeForSettings);
partnerLanguage.addEventListener("change", restartRealtimeForSettings);
domainMode.addEventListener("change", restartRealtimeForSettings);
