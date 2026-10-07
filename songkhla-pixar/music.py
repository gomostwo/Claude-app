# Generates a royalty-free, upbeat tropical background track (music.wav).
# Usage: python3 music.py [seconds] [out.wav]
import sys, wave
import numpy as np

SR = 44100
DUR = float(sys.argv[1]) if len(sys.argv) > 1 else 75
OUT = sys.argv[2] if len(sys.argv) > 2 else "music.wav"
BPM = 104
BEAT = 60 / BPM
BAR = BEAT * 4
N = int(SR * DUR)
mix = np.zeros(N)
rng = np.random.default_rng(3)

def hz(m): return 440 * 2 ** ((m - 69) / 12)

def add(sig, start):
    i = int(start * SR)
    if i >= N: return
    seg = sig[: N - i]
    mix[i:i + len(seg)] += seg

def marimba(m, dur=0.6, amp=0.22):
    t = np.arange(int(dur * SR)) / SR
    f = hz(m)
    return amp * (np.sin(2*np.pi*f*t) * np.exp(-t*6) + 0.35*np.sin(2*np.pi*4*f*t) * np.exp(-t*22))

def pad(ms, dur, amp=0.05):
    t = np.arange(int(dur * SR)) / SR
    env = np.minimum(1, t / 0.4) * np.minimum(1, (dur - t) / 0.5)
    s = sum(np.sin(2*np.pi*hz(m)*t) + 0.3*np.sin(2*np.pi*2*hz(m)*t + 0.5) for m in ms)
    return amp * env * s

def bass(m, dur, amp=0.22):
    t = np.arange(int(dur * SR)) / SR
    return amp * np.sin(2*np.pi*hz(m)*t) * np.exp(-t*2.5) * np.minimum(1, t/0.01)

def kick(amp=0.5):
    t = np.arange(int(0.25 * SR)) / SR
    f = 50 + 90*np.exp(-t*30)
    return amp * np.sin(2*np.pi*np.cumsum(f)/SR) * np.exp(-t*14)

def shaker(amp=0.05):
    n = rng.standard_normal(int(0.06 * SR))
    n = np.diff(n, prepend=0)  # crude high-pass
    return amp * n * np.exp(-np.arange(len(n))/SR*60)

# C - G - Am - F  (MIDI roots / chord tones)
prog = [(48, [60, 64, 67]), (43, [59, 62, 67]), (45, [60, 64, 69]), (41, [60, 65, 69])]
arp = [0, 1, 2, 1, 2, 0, 1, 2]
bar = 0
while bar * BAR < DUR:
    t0 = bar * BAR
    root, ch = prog[bar % 4]
    add(pad(ch, BAR + 0.3), t0)
    for b in range(4):
        add(bass(root if b % 2 == 0 else root + 7, BEAT), t0 + b*BEAT)
        if bar >= 1:
            if b in (0, 2): add(kick(), t0 + b*BEAT)
        add(shaker(), t0 + b*BEAT + BEAT/2)
    if bar >= 2:
        for k, idx in enumerate(arp):
            add(marimba(ch[idx] + 12), t0 + k*BEAT/2)
    bar += 1

t = np.arange(N) / SR
mix *= np.minimum(1, t / 1.5) * np.minimum(1, (DUR - t) / 3.0)
mix = mix / np.max(np.abs(mix)) * 0.7
with wave.open(OUT, "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((mix * 32767).astype(np.int16).tobytes())
print("wrote", OUT)
