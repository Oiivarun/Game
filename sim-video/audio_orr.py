"""Soundtrack for the phantom jam, synthesised from the simulation's cues.

    python3 audio_orr.py out/orr-phantom-jam-cues.json out/orr-phantom-jam.wav

Only needs numpy. The traffic you hear is the traffic on screen: engines and
tyres follow the average speed, idling autos and the honking follow how much
of the road is stopped. On top: the tyre squeal of the one brake, a ticking
pulse that speeds up with the clock, a hit on every big number, and a pad
that resolves on "phantom jam".
"""
import json
import sys
import wave

import numpy as np

SR = 44100
cues = json.load(open(sys.argv[1]))
OUT = sys.argv[2]
D = cues['duration']
N = int(D * SR)
t = np.arange(N) / SR
rng = np.random.default_rng(11)
ct = np.array(cues['t'])


def cue(name):
    return np.interp(t, ct, np.array(cues[name], dtype=float))


def smoothstep(e0, e1, x):
    k = np.clip((x - e0) / (e1 - e0), 0, 1)
    return k * k * (3 - 2 * k)


def filt(x, lo=None, hi=None, tilt=0.0):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    m = np.ones_like(f)
    if lo:
        m /= 1 + (lo / np.maximum(f, 1e-3)) ** 4
    if hi:
        m /= 1 + (f / hi) ** 4
    if tilt:
        m *= (np.maximum(f, 20) / 1000.0) ** tilt
    return np.fft.irfft(X * m, len(x))


def fftconv(x, k):
    size = 1 << int(np.ceil(np.log2(len(x) + len(k))))
    return np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(k, size), size)[: len(x)]


def norm(x):
    return x / (np.sqrt(np.mean(x ** 2)) + 1e-9)


def noise(lo=None, hi=None, tilt=0.0):
    return norm(filt(rng.standard_normal(N), lo, hi, tilt))


L = np.zeros(N)
R = np.zeros(N)
wetL = np.zeros(N)
wetR = np.zeros(N)


def put(sig, i0=0, pan=0.0, gain=1.0, wet=0.0):
    i1 = min(N, i0 + len(sig))
    if i0 >= N or i1 <= 0:
        return
    s = sig[: i1 - i0] * gain
    gl, gr = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    L[i0:i1] += s * gl * (1 - wet)
    R[i0:i1] += s * gr * (1 - wet)
    wetL[i0:i1] += s * gl * wet
    wetR[i0:i1] += s * gr * wet


speed = cue('speed')            # m/s, traffic in view
stopped = cue('stopped')        # fraction of it standing still
near = cue('nearBrake')         # braking right under the camera
clock = cue('clock')            # sim seconds per video second
moving = np.clip(speed / 8.0, 0, 1.2)

# --- the road ------------------------------------------------------------
put(noise(70, 420, -0.3) * (0.45 + 0.55 * moving) * 0.045, pan=-0.2)         # engines
put(noise(700, 5000, -0.2) * (0.15 + 0.85 * moving ** 1.3) * 0.045, pan=0.2)  # tyres
# Idling two-stroke autos: a 26 Hz putter that comes up as the road stops.
putter = (0.5 + 0.5 * np.sign(np.sin(2 * np.pi * 26 * t + 3 * np.sin(2 * np.pi * 0.7 * t)))) * noise(80, 900)
put(putter * stopped * 0.03, pan=0.4)
put(noise(90, 700) * near * 0.03, pan=-0.4)                                    # brakes and engines right below

# Horns: Bengaluru honks more the longer it waits.
kinds = [
    (lambda tt: sum(np.sin(2 * np.pi * f * h * tt) / h for f in (415, 523) for h in (1, 3, 5)), 0.02),   # car
    (lambda tt: sum(np.sin(2 * np.pi * 1050 * h * tt) / h ** 1.3 for h in (1, 2, 3)), 0.014),             # auto
    (lambda tt: sum(np.sin(2 * np.pi * 560 * h * tt) / h for h in (1, 2, 4)), 0.016),                     # scooter
    (lambda tt: sum(np.sin(2 * np.pi * f * tt) for f in (277, 349, 415)) / 2, 0.022),                     # bus
]
honk_rate = 0.5 + 7.0 * stopped + 2.0 * near
tt0 = 0.2
while tt0 < D - 0.6:
    i = int(tt0 * SR)
    tt0 += rng.exponential(1 / max(0.3, honk_rate[i]))
    fn, gain = kinds[rng.choice(4, p=[0.45, 0.2, 0.25, 0.1])]
    beeps = rng.choice([1, 1, 2, 3])
    for b in range(beeps):
        dur = rng.uniform(0.08, 0.35) if beeps > 1 else rng.uniform(0.15, 0.7)
        n = int(dur * SR)
        tt = np.arange(n) / SR
        env = np.minimum(1, tt / 0.008) * np.minimum(1, (dur - tt) / 0.03)
        put(fn(tt) * env * gain * 2.6 * rng.uniform(0.35, 1.0), int((tt0 + b * (dur + 0.07)) * SR), pan=rng.uniform(-0.85, 0.85), wet=0.25)

# --- the one brake ------------------------------------------------------
b0 = cues['brake']
n = int(1.6 * SR)
tt = np.arange(n) / SR
squeal_f = 3100 + 120 * np.sin(2 * np.pi * 9 * tt) - 400 * tt
squeal = np.sin(2 * np.pi * np.cumsum(squeal_f) / SR) * np.minimum(1, tt / 0.05) * np.exp(-tt / 0.7)
scrub = norm(filt(rng.standard_normal(n), 900, 6000)) * np.minimum(1, tt / 0.03) * np.exp(-tt / 0.5)
put(squeal * 0.08 + scrub * 0.05, int(b0 * SR), pan=0.15, wet=0.35)

# --- music: a pad, a clock that ticks faster as time speeds up -----------
NOTE = {n: 440 * 2 ** ((i - 57) / 12) for i, n in enumerate(
    [f'{p}{o}' for o in range(0, 8) for p in ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']])}
CHORDS = [
    (0.0, 6.8, ['A1', 'E3', 'A3', 'C4', 'E4'], 0.8),     # evening, before anything happens
    (6.2, 15.8, ['F1', 'C3', 'A3', 'C4', 'E4'], 1.0),    # the wave travels
    (15.2, 22.8, ['D2', 'A2', 'F3', 'C4', 'G4'], 1.1),   # time flies
    (22.2, 25.8, ['E1', 'B2', 'G#3', 'D4', 'E4'], 1.1),  # an hour later
    (25.4, 29.5, ['A1', 'E2', 'C#3', 'A3', 'E4', 'B4'], 1.0),  # phantom jam
]
for (c0, c1, notes, g) in CHORDS:
    for j, nn in enumerate(notes):
        f = NOTE[nn]
        i0 = int(c0 * SR)
        i1 = min(N, int((c1 + 2.0) * SR))
        tt = np.arange(i0, i1) / SR
        env = smoothstep(c0, c0 + 1.4, tt) * (1 - smoothstep(c1, c1 + 2.0, tt))
        sig = np.zeros(len(tt))
        for dt in (-0.004, 0.0, 0.0045):
            ph = rng.uniform(0, 6.28)
            for h in range(1, 6 if f < 200 else 4):
                sig += np.sin(2 * np.pi * f * (1 + dt) * h * tt + ph * h) / h ** 1.7
        put(sig * env * 0.012 * g / (1 + 0.1 * j), i0, pan=(-0.6 + 1.2 * j / (len(notes) - 1)) * 0.7, wet=0.55)

# Ticks: 2 per second in real time, up to 9 per second at the fastest.
tick_rate = 2 + 7 * np.clip(np.log10(np.maximum(clock, 1)) / np.log10(750), 0, 1)
phase = np.cumsum(tick_rate) / SR
ticks = np.zeros(N)
idx = np.nonzero(np.diff(np.floor(phase)) > 0)[0]
ticks[idx] = 1
click = np.exp(-np.arange(int(0.04 * SR)) / (0.004 * SR)) * np.sin(2 * np.pi * 2200 * np.arange(int(0.04 * SR)) / SR)
tick_gain = smoothstep(3.6, 5.0, t) * (1 - smoothstep(24.4, 25.6, t))
put(fftconv(ticks, click) * tick_gain * 0.2, pan=0.25, wet=0.2)
thump = np.exp(-np.arange(int(0.25 * SR)) / (0.06 * SR)) * np.sin(2 * np.pi * 55 * np.arange(int(0.25 * SR)) / SR)
beat = np.zeros(N)
beat[idx[::2]] = 1
put(fftconv(beat, thump) * tick_gain * 0.22)


def boom(at, gain=1.0, f0=62, f1=34, decay=0.9):
    n = int(3.5 * SR)
    tt = np.arange(n) / SR
    f = f1 + (f0 - f1) * np.exp(-tt / 0.35)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt / decay)
    put(body * 0.24 * gain, int(at * SR), wet=0.4)


def riser(at, length=1.0):
    n = int(length * SR)
    k = np.linspace(0, 1, n)
    put(norm(filt(rng.standard_normal(n), 300, 6000)) * k ** 3 * 0.04, int((at - length) * SR), wet=0.5)


for ts in cues['stamps']:
    riser(ts)
    boom(ts)
boom(b0, gain=0.6, f0=90, f1=50, decay=0.4)
boom(25.8, gain=1.2, f0=70, f1=36, decay=1.4)

# --- reverb, master --------------------------------------------------------
def reverb(x, seconds=2.6, seed=0):
    r = np.random.default_rng(seed)
    n = int(seconds * SR)
    tt = np.arange(n) / SR
    ir = filt(r.standard_normal(n) * np.exp(-tt * 6.9 / seconds), 150, 6000)
    ir[: int(0.01 * SR)] = 0
    return fftconv(x, ir / np.sqrt(np.sum(ir ** 2)))


L += wetL * 0.35 + reverb(wetL, seed=1) * 0.9
R += wetR * 0.35 + reverb(wetR, seed=2) * 0.9
mix = np.stack([filt(L, lo=32, tilt=0.1), filt(R, lo=32, tilt=0.1)])
mix *= smoothstep(0.0, 0.4, t) * (1 - smoothstep(D - 0.9, D, t))
mix *= 10 ** (-21.5 / 20) / np.sqrt(np.mean(mix ** 2))
mix = np.tanh(mix * 1.1) / np.tanh(1.1)
mix *= 10 ** (-1 / 20) / max(1e-9, np.max(np.abs(mix)))
with wave.open(OUT, 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((mix.T * 32767).astype('<i2').tobytes())
print(f'{OUT}: {D:.1f}s')
