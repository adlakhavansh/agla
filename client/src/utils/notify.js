// The "your food is ready" moment: a two-tone ding, a buzz on phones, and a system
// notification if the tab is in the background.
let audio;

export const ding = () => {
  try {
    audio ??= new AudioContext();
    const now = audio.currentTime;
    [880, 1318.5].forEach((freq, i) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = freq;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.0001, now + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.25, now + i * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.6);
      osc.connect(gain).connect(audio.destination);
      osc.start(now + i * 0.18);
      osc.stop(now + i * 0.18 + 0.65);
    });
  } catch {
    // Sound is a bonus; some browsers block it until the page is touched.
  }
};

export const buzz = () => navigator.vibrate?.([120, 80, 120]);

export const askToNotify = () => {
  if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
};

export const notify = (title, body) => {
  if (document.visibilityState === "visible") return;
  if ("Notification" in window && Notification.permission === "granted") new Notification(title, { body, icon: "/favicon.svg" });
};
