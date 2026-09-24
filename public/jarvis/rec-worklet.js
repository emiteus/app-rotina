/* global AudioWorkletProcessor, registerProcessor */
/**
 * Gravação do "segure pra falar": manda as amostras (taxa nativa do iPhone, normalmente 48 kHz)
 * em blocos pro app, que junta, reduz pra 16 kHz e monta o WAV. Manda também o nível pro reator.
 */
class Rec extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = [];
    this.n = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    this.buf.push(new Float32Array(ch));
    this.n += ch.length;
    // ~2.048 amostras por mensagem (~40 ms a 48 kHz)
    if (this.n >= 2048) {
      const out = new Float32Array(this.n);
      let o = 0;
      let sum = 0;
      for (const b of this.buf) {
        out.set(b, o);
        o += b.length;
        for (let i = 0; i < b.length; i++) sum += b[i] * b[i];
      }
      this.port.postMessage({ pcm: out, rms: Math.sqrt(sum / this.n) }, [out.buffer]);
      this.buf = [];
      this.n = 0;
    }
    return true;
  }
}

registerProcessor('jarvis-rec', Rec);
