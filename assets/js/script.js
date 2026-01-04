// HTTPS endpoint of the Cloudflare Worker that handles text replies
const VOICE_WORKER_URL = 'https://albamen-voice.nncdecdgc.workers.dev';

let recognition = null;
let isListening = false;

// Попытка получить общую "личность" Albamen (sessionId + name/age)
function getVoiceIdentity() {
  // Сначала пробуем то, что положили из include.js
  if (window.albamenVoiceIdentity) {
    return window.albamenVoiceIdentity;
  }

  // Потом — общий хелпер, если доступен
  if (typeof window.getAlbamenIdentity === 'function') {
    return window.getAlbamenIdentity();
  }

  // Фолбэк: читаем напрямую из localStorage
  let sessionId = localStorage.getItem('albamen_session_id');
  if (!sessionId) {
    if (window.crypto && crypto.randomUUID) {
      sessionId = crypto.randomUUID();
    } else {
      sessionId = 'sess-' + Date.now() + '-' + Math.random().toString(16).slice(2);
    }
    localStorage.setItem('albamen_session_id', sessionId);
  }

  return {
    sessionId,
    name: localStorage.getItem('albamen_user_name') || null,
    age: localStorage.getItem('albamen_user_age') || null,
  };
}

// Обновление глобальной identity после того, как воркер прислал новое имя/возраст
function refreshVoiceIdentity() {
  if (typeof window.getAlbamenIdentity === 'function') {
    window.albamenVoiceIdentity = window.getAlbamenIdentity();
  } else {
    window.albamenVoiceIdentity = {
      sessionId: localStorage.getItem('albamen_session_id'),
      name: localStorage.getItem('albamen_user_name'),
      age: localStorage.getItem('albamen_user_age'),
    };
  }
}

//
// Кнопка вызова голосового чата
//
const voiceBtn = document.getElementById('ai-voice-btn-panel') || document.querySelector('.ai-voice-btn') || document.querySelector('.ai-call-btn');
const voiceModal = document.querySelector('.ai-panel-voice'); // модальное окно (если есть)
const chatPanel = document.querySelector('.ai-panel-global');
const avatarImg = (voiceModal || chatPanel)?.querySelector('.ai-chat-avatar-large img'); // аватар для свечения
const closeBtn = voiceModal?.querySelector('.ai-close-icon'); // кнопка закрытия (X)
const statusEl = document.getElementById('voice-status-text') || document.getElementById('ai-status-text');
const inlineControls = document.getElementById('voice-inline-controls');
const chatStatusEl = document.getElementById('ai-status-text');
const waveEl = document.getElementById('voice-wave');
const stopBtn = document.getElementById('voice-stop-btn');

function enterVoiceMode() {
  chatPanel?.classList.add('voice-active');
  inlineControls?.classList.remove('hidden');
  if (chatStatusEl) chatStatusEl.style.display = 'none';
  if (statusEl) statusEl.style.display = 'block';
}

function exitVoiceMode() {
  chatPanel?.classList.remove('voice-active');
  inlineControls?.classList.add('hidden');
  waveEl?.classList.add('hidden');
  stopBtn?.classList.add('hidden');
  if (chatStatusEl) chatStatusEl.style.display = '';
  if (statusEl && statusEl.id === 'voice-status-text') statusEl.style.display = 'none';
}

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
  if (!statusEl && chatStatusEl) chatStatusEl.textContent = text;
}

function toggleListening(on) {
  isListening = on;
  waveEl?.classList.toggle('hidden', !on);
  stopBtn?.classList.toggle('hidden', !on);
}

async function sendTextToWorker(transcript) {
  const identity = getVoiceIdentity();
  try {
    const response = await fetch(VOICE_WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: transcript,
        sessionId: identity.sessionId,
        savedName: identity.name,
        savedAge: identity.age,
      }),
    });

    const data = await response.json();

    // Сохраняем имя/возраст, если пришли
    if (data.saveName && typeof data.saveName === 'string') {
      localStorage.setItem('albamen_user_name', data.saveName.trim());
    }
    if (data.saveAge && typeof data.saveAge === 'string') {
      localStorage.setItem('albamen_user_age', data.saveAge.trim());
    }
    refreshVoiceIdentity();

    const reply = (data.reply || '').trim();
    if (reply) {
      speakReply(reply);
    }
    setStatus(reply || 'Albamen şu anda cevap veremiyor.');
    if (!('speechSynthesis' in window)) {
      exitVoiceMode();
    }
  } catch (err) {
    console.error('Voice worker error:', err);
    setStatus('Bağlantı hatası, lütfen tekrar deneyin.');
    exitVoiceMode();
  }
}

function speakReply(text) {
  if (!('speechSynthesis' in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'tr-TR';
  utterance.onstart = () => {
    if (avatarImg) avatarImg.classList.add('ai-glow');
  };
  utterance.onend = () => {
    if (avatarImg) avatarImg.classList.remove('ai-glow');
    exitVoiceMode();
  };
  window.speechSynthesis.speak(utterance);
}

if (voiceBtn && voiceModal) {
  voiceBtn.addEventListener('click', () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setStatus('Ses desteği yok');
      return;
    }

    if (voiceModal) voiceModal.classList.add('ai-open');
    enterVoiceMode();
    if (recognition) recognition.stop();

    recognition = new SpeechRecognition();
    recognition.lang = 'tr-TR';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      toggleListening(true);
      setStatus('Dinliyorum...');
    };

    recognition.onerror = (event) => {
      toggleListening(false);
      setStatus(event.error === 'no-speech' ? 'Ses algılanmadı' : 'Ses hatası');
      exitVoiceMode();
    };

    recognition.onresult = (event) => {
      toggleListening(false);
      const transcript = event.results[0][0].transcript;
      setStatus('Albamen düşünüyor...');
      sendTextToWorker(transcript);
    };

    recognition.onend = () => {
      toggleListening(false);
      if (!isListening) exitVoiceMode();
    };

    recognition.start();
  });
}

// Закрытие модалки
if (closeBtn) {
  closeBtn.addEventListener('click', () => {
    voiceModal.classList.remove('ai-open');
    if (recognition && isListening) recognition.stop();
    toggleListening(false);
    exitVoiceMode();
  });
}

if (stopBtn) {
  stopBtn.addEventListener('click', () => {
    if (recognition && isListening) recognition.stop();
    toggleListening(false);
    setStatus('Durduruldu');
    exitVoiceMode();
  });
}
