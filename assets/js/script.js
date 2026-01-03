// URL вашего голосового Worker'а (замените на реальный!)
const VOICE_WORKER_URL = 'wss://albamen-voice.nncdecdgc.workers.dev'; // пример, укажите точный

let ws = null;
let mediaRecorder = null;
let stream = null;

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
const voiceBtn = document.querySelector('.ai-voice-btn') || document.querySelector('.ai-call-btn');
const voiceModal = document.querySelector('.ai-panel-voice'); // модальное окно
const avatarImg = voiceModal?.querySelector('.ai-chat-avatar-large img'); // аватар для свечения
const closeBtn = voiceModal?.querySelector('.ai-close-icon'); // кнопка закрытия (X)

if (voiceBtn && voiceModal) {
  voiceBtn.addEventListener('click', async () => {
    // Открываем модалку
    voiceModal.classList.add('ai-open');

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      alert('Mikrofon izni verilmedi. Lütfen izin verin.');
      voiceModal.classList.remove('ai-open');
      return;
    }

    ws = new WebSocket(VOICE_WORKER_URL);

    ws.onopen = () => {
      console.log('WebSocket bağlı — ses kaydı başlıyor');

      // ⚡ Отправляем воркеру "инициализационный" JSON с sessionId и сохранённым именем/возрастом
      const identity = getVoiceIdentity();
      try {
        ws.send(JSON.stringify({
          type: 'init',
          sessionId: identity.sessionId,
          savedName: identity.name,
          savedAge: identity.age,
          // Можешь при желании добавить сюда lang / mode и т.п.
        }));
      } catch (e) {
        console.warn('Failed to send init identity to voice worker:', e);
      }

      mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && ws && ws.readyState === WebSocket.OPEN) {
          ws.send(event.data); // бинарный аудио-чанк
        }
      };
      mediaRecorder.start(250); // низкая задержка
    };

    ws.onmessage = (event) => {
      // Вариант 1: воркер прислал текст (JSON с saveName/saveAge или другие служебные данные)
      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data);

          // Если воркер сообщает новое имя/возраст — сохраняем в localStorage
          if (msg.saveName && typeof msg.saveName === 'string') {
            const newName = msg.saveName.trim();
            if (newName) {
              localStorage.setItem('albamen_user_name', newName);
            }
          }
          if (msg.saveAge && typeof msg.saveAge === 'string') {
            const newAge = msg.saveAge.trim();
            if (newAge) {
              localStorage.setItem('albamen_user_age', newAge);
            }
          }

          // Обновляем глобальную identity, чтобы следующий запуск (и текстовый бот) видел новые данные
          refreshVoiceIdentity();
        } catch (e) {
          console.warn('Albamen voice: failed to parse JSON message', e, event.data);
        }
        return;
      }

      // Вариант 2: воркер прислал аудио-Blob (как и раньше)
      if (event.data instanceof Blob) {
        event.data.arrayBuffer().then(buffer => {
          const audioBlob = new Blob([buffer], { type: 'audio/wav' });
          const audioUrl = URL.createObjectURL(audioBlob);
          const audio = new Audio(audioUrl);
          audio.play();

          // Свечение аватара на время воспроизведения
          if (avatarImg) {
            avatarImg.classList.add('ai-glow');
            audio.onended = () => avatarImg.classList.remove('ai-glow');
          }
        });
      }
    };

    ws.onclose = ws.onerror = () => {
      console.log('WebSocket kapandı');
      stopRecording();
    };
  });
}

// Закрытие модалки
if (closeBtn) {
  closeBtn.addEventListener('click', () => {
    voiceModal.classList.remove('ai-open');
    if (ws) ws.close();
    stopRecording();
  });
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  if (stream) stream.getTracks().forEach(t => t.stop());
}
