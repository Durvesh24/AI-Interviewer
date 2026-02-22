/**
 * Voice Interaction Logic for AI Interviewer
 * Uses Web Speech API for Speech-to-Text (STT) and Text-to-Speech (TTS).
 */

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isListening = false;

// Initialize Recognition
if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = false; // Stop after one sentence/phrase vs continuous stream
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
}

/**
 * Toggle Microphone for Speech-to-Text
 * @param {HTMLElement} btn - The mic button element
 * @param {HTMLTextAreaElement} input - The input field to fill
 */
function toggleVoiceInput(btn, inputId) {
    if (!SpeechRecognition) {
        showToast("Voice input is not supported in this browser.", "error");
        return;
    }

    const input = document.getElementById(inputId);
    if (!input) return;

    if (isListening) {
        stopListening(btn);
    } else {
        startListening(btn, input);
    }
}

function startListening(btn, input) {
    if (!recognition) return;

    try {
        recognition.start();
        isListening = true;
        btn.classList.add('listening');
        btn.innerHTML = '🔴 Listening...';

        // Handle results
        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            input.value = transcript;
        };

        recognition.onend = () => {
            stopListening(btn);
        };

        recognition.onerror = (event) => {
            console.error("Speech recognition error", event.error);
            stopListening(btn);
            if (event.error === 'not-allowed') {
                showToast("Microphone access denied.", "error");
            }
        };

    } catch (e) {
        console.error(e);
        stopListening(btn);
    }
}

function stopListening(btn) {
    if (!isListening) return; // Already stopped

    if (recognition) recognition.stop();
    isListening = false;
    btn.classList.remove('listening');
    btn.innerHTML = '🎤 Speak Answer';
}

/**
 * Read Text Aloud (Text-to-Speech)
 * @param {string} text - Text to read
 * @param {HTMLElement} btn - Button that triggered it (to toggle icon)
 */
function speakText(text, btn) {
    if (!window.speechSynthesis) {
        showToast("Text-to-speech is not supported.", "error");
        return;
    }

    if (window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
        if (btn) btn.innerHTML = '🔊 Read Question';
        return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 1;
    utterance.pitch = 1;

    if (btn) btn.innerHTML = '⏹️ Stop Reading';

    utterance.onend = () => {
        if (btn) btn.innerHTML = '🔊 Read Question';
    };

    window.speechSynthesis.speak(utterance);
}
