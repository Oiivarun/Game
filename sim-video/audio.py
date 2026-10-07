"""Ambient soundtrack for the Moon video, synthesised from the timeline cues.

    python3 audio.py out/cues.json out/ambience.wav

Only needs numpy. Every layer is driven by the same cues as the picture:
waves and tides, Marine Drive traffic, a slow pad that changes with each
chapter, hits on every big number, the quake, the Moon cracking, meteors,
and a glassy shimmer under the rings.
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
rng = np.random.default_rng(7)
ct = np.array(cues['t'])


def cue(name):
    return np.interp(t, ct, np.array(cues[name], dtype=float))


def smoothstep(e0, e1, x):
    k = np.clip((x - e0) / (e1 - e0), 0, 1)
    return k * k * (3 - 2 * k)


def filt(x, lo=None, hi=None, tilt=0.0):
    """Zero-phase FFT filter: soft high/low-pass and an optional spectral tilt."""
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


def norm(x):
    return x / (np.sqrt(np.mean(x ** 2)) + 1e-9)


def fftconv(x, k):
    size = 1 << int(np.ceil(np.log2(len(x) + len(k))))
    return np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(k, size), size)[: len(x)]


def noise(lo=None, hi=None, tilt=0.0):
    return norm(filt(rng.standard_normal(N), lo, hi, tilt))


def slow(rate=0.3, octaves=3):
    """Smooth random wobble in [-1, 1]."""
    out = np.zeros(N)
    for o in range(octaves):
        f = rate * 2 ** o
        out += np.sin(2 * np.pi * f * t + rng.uniform(0, 6.28)) / 2 ** o
    return out / 1.75


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


sea = cue('seaLevel')
waves = cue('waves')
quake = cue('quake')
crack = cue('crack')
breakup = cue('breakup')
ring = cue('ring')
traffic = cue('traffic')
people = cue('people')
wild = cue('wild')
dist = cue('dist')

# --- the sea -------------------------------------------------------------
swell = 0.5 + 0.5 * np.sin(2 * np.pi * 0.105 * t + 0.4 * np.sin(2 * np.pi * 0.031 * t))
swell2 = 0.5 + 0.5 * np.sin(2 * np.pi * 0.083 * t + 2.1)
near = np.clip((sea + 12) / 12, 0.3, 1.0)              # the bay draining pushes the surf away
sea_amt = (0.5 + waves * 0.9) * near
for side, sw in ((-0.5, swell), (0.5, swell2)):
    body = noise(90, 900, -0.3) * (0.35 + 0.65 * sw ** 2)
    wash = noise(1200, 8000, -0.3) * (sw ** 4)
    put(body * sea_amt * 0.07 + wash * sea_amt * 0.075, pan=side)

# Water rushing in when the tide climbs fast, sucking out when it drops.
dsea = np.gradient(sea, 1 / SR)
surge = np.clip(dsea / 5.0, 0, 1.5)
suck = np.clip(-dsea / 6.0, 0, 1.0)
put(noise(150, 3000, -0.3) * surge * 0.16, pan=-0.2)
put(noise(80, 900, -0.5) * suck * 0.08, pan=0.2)

# --- Marine Drive: traffic hum, pass-bys, horns, people on the wall --------
put(noise(45, 320, -0.4) * traffic * (0.75 + 0.25 * slow(0.2)) * 0.07, pan=-0.3)
for _ in range(14):
    t0 = rng.uniform(0.2, 11.0)
    dur = rng.uniform(1.2, 2.4)
    n = int(dur * SR)
    k = np.linspace(0, 1, n)
    env = np.sin(np.pi * k) ** 3
    sig = filt(rng.standard_normal(n), 120, 1800) * env
    put(norm(sig) * env * 0.035, int(t0 * SR), pan=rng.uniform(-0.8, 0.8))
for _ in range(16):
    t0 = rng.uniform(0.6, 11.2)
    f1 = rng.uniform(380, 470)
    beeps = 1 if rng.random() < 0.6 else 2
    for b in range(beeps):
        dur = rng.uniform(0.12, 0.42)
        n = int(dur * SR)
        tt = np.arange(n) / SR
        env = np.minimum(1, tt / 0.01) * np.minimum(1, (dur - tt) / 0.03)
        sig = sum(np.sin(2 * np.pi * f * h * tt) / h for f in (f1, f1 * 1.26) for h in (1, 3, 5))
        put(sig * env * rng.uniform(0.008, 0.02), int((t0 + b * (dur + 0.09)) * SR), pan=rng.uniform(-0.7, 0.7), wet=0.35)
babble = noise(250, 2200) * (0.5 + 0.5 * np.abs(filt(rng.standard_normal(N), hi=6)) * 6).clip(0, 2)
put(babble * people * 0.012, pan=0.35)

# --- pad: one chord per chapter -----------------------------------------
NOTE = {n: 440 * 2 ** ((i - 57) / 12) for i, n in enumerate(
    [f'{p}{o}' for o in range(0, 8) for p in ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']])}
CHORDS = [
    (0.0, 11.8, ['D2', 'A3', 'F#4', 'E5'], 1.0),          # warm evening
    (11.0, 25.2, ['B1', 'F#3', 'D4', 'A4'], 1.0),         # the tides start
    (24.5, 33.8, ['G1', 'D3', 'B3', 'F#4'], 1.0),         # night flood
    (33.2, 41.6, ['A1', 'E3', 'B3', 'E4'], 0.95),         # the Moon rises in the west
    (41.0, 48.4, ['D1', 'A2', 'D#3', 'A#3'], 1.25),       # giant tides, the ground heaves
    (47.8, 49.3, ['A#1', 'F3', 'D4', 'A4'], 1.5),         # the Roche limit
    (53.5, 60.6, ['D1', 'A2', 'F3', 'C4'], 0.8),          # rock rain
    (59.6, 76.0, ['D2', 'A2', 'F#3', 'E4', 'A4', 'D5'], 1.0),  # rings
]
for (c0, c1, notes, g) in CHORDS:
    rel = 0.25 if c1 == 49.3 else 3.0
    for j, nn in enumerate(notes):
        f = NOTE[nn]
        i0 = int(c0 * SR)
        i1 = min(N, int((c1 + rel) * SR))
        tt = np.arange(i0, i1) / SR
        env = smoothstep(c0, c0 + 2.6, tt) * (1 - smoothstep(c1, c1 + rel, tt))
        env *= 0.8 + 0.2 * np.sin(2 * np.pi * (0.07 + 0.03 * j) * tt + j)
        sig = np.zeros(len(tt))
        harmonics = 7 if f < 200 else 4
        for dt in (-0.0035, 0.0, 0.0041):
            ph = rng.uniform(0, 6.28)
            for h in range(1, harmonics + 1):
                sig += np.sin(2 * np.pi * f * (1 + dt) * h * tt + ph * h) / h ** 1.7
        amp = 0.016 * g * (1.25 if f < 120 else 1.0) / (1 + j * 0.12)
        if c0 == 41.0:  # trembling during the quake
            sig *= 1 + 0.35 * np.sin(2 * np.pi * 5.5 * tt) * quake[i0:i1]
        put(sig * env * amp, i0, pan=(-0.6 + 1.2 * j / max(1, len(notes) - 1)) * 0.7, wet=0.55)

# Sub-bass that tightens as the Moon closes in, gone when it breaks.
closeness = np.clip(np.log(384400 / dist) / np.log(384400 / 18400), 0, 1)
sub = np.sin(2 * np.pi * NOTE['D1'] * t) + 0.3 * np.sin(2 * np.pi * NOTE['D1'] * 2 * t)
put(sub * closeness ** 1.6 * (1 - smoothstep(49.0, 50.0, t)) * 0.05)

# --- hits on every big number -------------------------------------------
def boom(at, gain=1.0, f0=62, f1=34, decay=0.9, wet=0.4):
    n = int(4 * SR)
    tt = np.arange(n) / SR
    f = f1 + (f0 - f1) * np.exp(-tt / 0.35)
    phase = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(phase) * np.exp(-tt / decay)
    thump = filt(rng.standard_normal(n), hi=180) * np.exp(-tt / 0.08)
    put((body + norm(thump) * 0.25) * 0.22 * gain, int(at * SR), wet=wet)


def riser(at, length=1.1, gain=1.0):
    n = int(length * SR)
    k = np.linspace(0, 1, n)
    sig = norm(filt(rng.standard_normal(n), 300, 6000)) * k ** 3
    put(sig * 0.045 * gain, int((at - length) * SR), wet=0.5)


for ts in cues['stamps']:
    riser(ts)
    boom(ts, gain=1.4 if 47 < ts < 49 else 1.0)

# --- the storm and the quake --------------------------------------------
storm = smoothstep(41.0, 42.5, t) * (1 - smoothstep(47.5, 49.0, t))
put(noise(180, 1400) * (0.6 + 0.4 * slow(0.25)) * storm * 0.05, pan=-0.4)
put(noise(1800, 11000) * storm * 0.035, pan=0.4)
rumble = noise(18, 95, -1.0) * (0.7 + 0.3 * slow(1.3))
put(rumble * quake * 0.2)
for _ in range(10):
    t0 = rng.uniform(42.5, 47.5)
    boom(t0, gain=rng.uniform(0.25, 0.5), f0=rng.uniform(70, 110), f1=40, decay=0.5, wet=0.2)

# Thunder behind the lightning flash that hides the wrecking of the city.
tw = cues['wreck']
n = int(5 * SR)
tt = np.arange(n) / SR
crack_s = norm(filt(rng.standard_normal(n), 200, 9000)) * np.exp(-tt / 0.12)
roll = norm(filt(rng.standard_normal(n), 25, 400, -0.6)) * np.exp(-tt / 1.6) * (0.7 + 0.3 * np.sin(2 * np.pi * 3 * tt))
put(crack_s * 0.2 + roll * 0.24, int((tw - 0.05) * SR), wet=0.3)

# --- the Moon cracking, then breaking -----------------------------------
dcrack = np.gradient(crack, 1 / SR)
rate = np.clip(dcrack, 0, None) * 120 + crack * (crack < 0.999) * 10
pops = (rng.random(N) < rate / SR).astype(float) * rng.uniform(0.3, 1.0, N)
click = np.exp(-np.arange(int(0.03 * SR)) / (0.006 * SR))
crackle = fftconv(pops, click) * rng.standard_normal(N)
put(norm(filt(crackle, 500, 5000)) * 0.03 * smoothstep(45.0, 46.0, t), pan=0.1, wet=0.4)
groan_f = 48 + 10 * crack
groan = np.sin(2 * np.pi * np.cumsum(groan_f) / SR) * crack * (1 - smoothstep(49.0, 49.4, t))
put(groan * 0.06, wet=0.3)
boom(49.25, gain=2.2, f0=80, f1=28, decay=2.2, wet=0.5)
debris = noise(60, 2500, -0.4) * breakup * (1 - breakup) * 4
put(debris * 0.035, pan=-0.1, wet=0.4)

# --- meteors --------------------------------------------------------------
hi_band = noise(1200, 7000)
lo_band = noise(250, 1600)
for m in cues['meteors']:
    i0 = int(m['t0'] * SR)
    n = int(m['dur'] * SR)
    if i0 + n >= N:
        continue
    k = np.linspace(0, 1, n)
    env = np.sin(np.pi * k) ** 2
    size = (m['w'] - 0.0012) / 0.006
    sig = hi_band[i0:i0 + n] * (1 - k) + lo_band[i0:i0 + n] * k
    pan = float(np.clip((m['az'] - 10) / 25, -1, 1))
    put(sig * env * (0.012 + 0.05 * size), i0, pan=pan, wet=0.3)
    if size > 0.35:
        boom(m['t0'] + m['dur'] + rng.uniform(0.6, 1.4), gain=0.2 + size * 0.3, f0=90, f1=45, decay=0.6, wet=0.5)

# --- the rings: glass shimmer, crickets in the new forest ----------------
bell_notes = ['D5', 'F#5', 'A5', 'E6', 'D6', 'A6', 'F#6']
tb = 60.5
while tb < 75.0:
    f = NOTE[bell_notes[rng.integers(len(bell_notes))]]
    n = int(4.5 * SR)
    tt = np.arange(n) / SR
    env = np.minimum(1, tt / 0.02) * np.exp(-tt / 1.4)
    sig = np.sin(2 * np.pi * f * tt) + 0.35 * np.sin(2 * np.pi * f * 2.76 * tt) * np.exp(-tt / 0.4)
    put(sig * env * 0.011 * float(np.interp(tb, ct, cues['ring'])), int(tb * SR), pan=rng.uniform(-0.8, 0.8), wet=0.7)
    tb += rng.uniform(0.45, 1.2)
for c in range(5):
    f = rng.uniform(4200, 5200)
    chirp_rate = rng.uniform(2.2, 3.4)
    gate = (np.sin(2 * np.pi * chirp_rate * t + rng.uniform(0, 6.28)) > 0.55).astype(float)
    pulse = 0.5 + 0.5 * np.sign(np.sin(2 * np.pi * 32 * t))
    sig = np.sin(2 * np.pi * f * t) * filt(gate * pulse, hi=400)
    put(sig * wild * 0.006, pan=rng.uniform(-0.9, 0.9), wet=0.2)
put(noise(150, 900) * (0.6 + 0.4 * slow(0.15)) * smoothstep(58, 64, t) * 0.02, pan=0.3)

# --- reverb, master ------------------------------------------------------
def reverb(x, seconds=3.2, seed=0):
    r = np.random.default_rng(seed)
    n = int(seconds * SR)
    tt = np.arange(n) / SR
    ir = r.standard_normal(n) * np.exp(-tt * 6.9 / seconds)
    ir = filt(ir, 120, 6000)
    ir[: int(0.012 * SR)] = 0
    ir /= np.sqrt(np.sum(ir ** 2))
    return fftconv(x, ir)


L += wetL * 0.35 + reverb(wetL, seed=1) * 0.9
R += wetR * 0.35 + reverb(wetR, seed=2) * 0.9

# Phones drop the deep lows; keep the mix out of the mud and a touch brighter.
mix = np.stack([filt(L, lo=32, tilt=0.12), filt(R, lo=32, tilt=0.12)])
fade = smoothstep(0.0, 0.6, t) * (1 - smoothstep(74.6, 76.0, t))
mix *= fade
rms = np.sqrt(np.mean(mix ** 2))
mix *= 10 ** (-17 / 20) / rms
mix = np.tanh(mix * 1.1) / np.tanh(1.1)
mix *= 10 ** (-1 / 20) / max(1e-9, np.max(np.abs(mix)))

pcm = (mix.T * 32767).astype('<i2')
with wave.open(OUT, 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print(f'{OUT}: {D:.1f}s, rms {20 * np.log10(np.sqrt(np.mean(mix ** 2))):.1f} dBFS')
