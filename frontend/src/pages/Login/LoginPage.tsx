import { useState, useRef, useEffect, useCallback, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { useT } from '../../hooks/useT';
import { useLangStore } from '../../store/langStore';

const TOTAL = 200;
const CELL = 22;

interface Particle {
  x: number; y: number; px: number; py: number;
  life: number; maxL: number; spd: number; sz: number;
  orange: boolean; vx: number; vy: number;
  init(): void;
}

class P implements Particle {
  x = 0; y = 0; px = 0; py = 0;
  life = 0; maxL = 0; spd = 0; sz = 0;
  orange = false; vx = 0; vy = 0;

  constructor(randomize: boolean, private W: number, private H: number) {
    this.init(randomize);
  }

  init(randomize = true) {
    this.x = Math.random() * this.W;
    this.y = Math.random() * this.H;
    this.px = this.x;
    this.py = this.y;
    this.life = randomize ? Math.random() * 300 : 0;
    this.maxL = 200 + Math.random() * 150;
    this.spd = 0.7 + Math.random() * 1.1;
    this.sz = 0.5 + Math.random() * 1.5;
    this.orange = Math.random() > 0.44;
    this.vx = 0;
    this.vy = 0;
  }

  step(mode: string, field: number[], cols: number, W: number, H: number, successT: number) {
    this.px = this.x; this.py = this.y;
    if (mode === 'implode') {
      const dt = performance.now() - successT;
      const pull = Math.min(1, dt / 380) * 5;
      const dx = W / 2 - this.x, dy = H / 2 - this.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      this.vx = this.vx * 0.88 + (dx / d) * pull * 0.18;
      this.vy = this.vy * 0.88 + (dy / d) * pull * 0.18;
      this.x += this.vx; this.y += this.vy;
    } else if (mode === 'explode') {
      const dx = this.x - W / 2, dy = this.y - H / 2;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = 6 + Math.random() * 4;
      this.vx = this.vx * 0.9 + (dx / d) * force * 0.15;
      this.vy = this.vy * 0.9 + (dy / d) * force * 0.15;
      this.x += this.vx; this.y += this.vy;
    } else {
      const ci = Math.floor(this.x / CELL);
      const ri = Math.floor(this.y / CELL);
      const idx = ri * cols + ci;
      const ang = field[idx] ?? 0;
      this.x += Math.cos(ang) * this.spd;
      this.y += Math.sin(ang) * this.spd;
      this.life++;
    }
    if (this.x < -10 || this.x > W + 10 || this.y < -10 || this.y > H + 10 || this.life > this.maxL) {
      this.init();
    }
  }

  draw(ctx: CanvasRenderingContext2D, mode: string) {
    const lt = this.life / this.maxL;
    const fade = mode === 'normal' || mode === 'intro'
      ? (lt < 0.12 ? lt / 0.12 : lt > 0.88 ? (1 - lt) / 0.12 : 1) : 1;
    const baseA = this.orange ? 0.55 : 0.42;
    ctx.globalAlpha = fade * baseA;
    ctx.strokeStyle = this.orange ? '#FF6200' : '#185FA5';
    ctx.lineWidth = this.sz;
    ctx.beginPath();
    ctx.moveTo(this.px, this.py);
    ctx.lineTo(this.x, this.y);
    ctx.stroke();
  }
}

export function LoginPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showCard, setShowCard] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { login, error, clearError, token } = useAuthStore();
  const navigate = useNavigate();
  const t = useT();
  const { lang, setLang } = useLangStore();

  // Redirect if already logged in
  useEffect(() => {
    if (token) navigate('/', { replace: true });
  }, [token, navigate]);

  // ── Canvas animation ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let W = 0, H = 0, cols = 0, rows = 0;
    let field: number[] = [];
    const particles: P[] = [];

    function resize() {
      W = canvas!.width = window.innerWidth;
      H = canvas!.height = window.innerHeight;
      cols = Math.ceil(W / CELL) + 1;
      rows = Math.ceil(H / CELL) + 1;
    }

    function buildField(t: number) {
      field = [];
      const T = t * 0.001;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const nx = c / cols, ny = r / rows;
          const a =
            Math.sin(nx * 4.2 + T * 0.28) * Math.PI * 1.4 +
            Math.cos(ny * 3.5 - T * 0.32) * Math.PI +
            Math.sin((nx + ny) * 5.1 - T * 0.19) * Math.PI * 0.6 +
            Math.cos((nx - ny) * 2.8 + T * 0.14) * Math.PI * 0.4;
          field.push(a);
        }
      }
    }

    function drawRibbons(t: number) {
      const T = t * 0.0003;
      const ribbons = [
        { y0: H * 0.25, cy: H * 0.15, amp: 80, col: 'rgba(255,98,0,0.025)', w: 120 },
        { y0: H * 0.60, cy: H * 0.70, amp: 100, col: 'rgba(24,95,165,0.02)', w: 160 },
        { y0: H * 0.80, cy: H * 0.85, amp: 60, col: 'rgba(255,98,0,0.018)', w: 100 },
      ];
      for (const { y0, cy, amp, col, w } of ribbons) {
        ctx!.save();
        ctx!.globalAlpha = 1;
        ctx!.fillStyle = col;
        ctx!.beginPath();
        ctx!.moveTo(0, y0 + Math.sin(T) * amp);
        ctx!.bezierCurveTo(
          W * 0.25, cy + Math.cos(T * 1.3) * amp * 0.8,
          W * 0.75, cy + Math.sin(T * 0.9) * amp,
          W, y0 + Math.cos(T * 1.1) * amp * 0.6
        );
        ctx!.lineTo(W, y0 + w + Math.cos(T * 1.1) * amp * 0.6);
        ctx!.bezierCurveTo(
          W * 0.25, cy + w + Math.sin(T * 0.9) * amp,
          W * 0.75, cy + w + Math.cos(T * 1.3) * amp * 0.8,
          0, y0 + w + Math.sin(T) * amp
        );
        ctx!.closePath();
        ctx!.fill();
        ctx!.restore();
      }
    }

    resize();
    for (let i = 0; i < TOTAL; i++) particles.push(new P(true, W, H));

    let mode = 'intro';
    let startT: number | null = null;
    let successT: number = 0;
    let cardVisible = false;

    function frame(now: number) {
      animRef.current = requestAnimationFrame(frame);
      if (!startT) startT = now;
      const elapsed = now - startT;

      ctx!.clearRect(0, 0, W, H);
      ctx!.fillStyle = '#FEFCF8';
      ctx!.fillRect(0, 0, W, H);

      buildField(now);
      drawRibbons(now);

      if (!cardVisible && elapsed > 750) {
        cardVisible = true;
        setShowCard(true);
      }
      if (elapsed > 1400 && mode === 'intro') mode = 'normal';
      if (mode !== 'implode' && mode !== 'explode') {
        for (const p of particles) {
          p.step(mode, field, cols, W, H, 0);
          p.draw(ctx!, mode);
        }
      }
    }

    animRef.current = requestAnimationFrame(frame);

    return () => cancelAnimationFrame(animRef.current);
  }, []);

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    clearError();
    setSubmitting(true);

    const ok = await login(username, password);
    if (ok) {
      setTimeout(() => navigate('/', { replace: true }), 900);
    } else {
      setSubmitting(false);
    }
  }, [username, password, login, navigate, clearError]);

  const quickLogin = (u: string) => {
    setUsername(u);
    setPassword('demo');
    setTimeout(() => {
      clearError();
      setSubmitting(true);
      login(u, 'demo').then(ok => {
        if (ok) setTimeout(() => navigate('/', { replace: true }), 900);
        else setSubmitting(false);
      });
    }, 60);
  };

  return (
    <div className="h-full relative overflow-hidden" style={{ background: '#FEFCF8' }}>
      <canvas ref={canvasRef} className="fixed inset-0 w-screen h-screen pointer-events-none" />

      <div
        className="fixed inset-0 z-10 flex items-center justify-center transition-all duration-800"
        style={{
          opacity: showCard ? 1 : 0,
          transform: showCard ? 'translateY(0) scale(1)' : 'translateY(18px) scale(0.97)',
          transitionTimingFunction: 'cubic-bezier(.16,1,.3,1)',
        }}
      >
        <div className="w-[420px] bg-white rounded-[22px] px-[38px] pt-[40px] pb-[34px] relative shadow-[0_2px_4px_rgba(0,0,0,.04),0_8px_24px_rgba(0,0,0,.07),0_32px_64px_rgba(255,98,0,.06)] overflow-hidden">
          {/* Animated gradient stripe */}
          <div className="absolute top-0 left-0 right-0 h-[3px] gradient-stripe" />

          {/* Logo row */}
          <div className="flex items-center gap-[14px] mb-[30px]">
            <div className="w-[54px] h-[54px] rounded-xl flex items-center justify-center shrink-0"
              style={{ background: 'linear-gradient(135deg,#FF6200,#cc4e00)' }}>
              <span className="text-white font-extrabold text-2xl font-mono">{t.brand.initial}</span>
            </div>
            <div>
              <div className="text-[22px] font-extrabold tracking-[-0.6px] font-mono"
                style={{ background: 'linear-gradient(135deg, #FF6200, #cc4e00)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                {t.brand.name}
              </div>
              <div className="text-[11px] text-gray-400 tracking-wider uppercase mt-0.5">{t.brand.platform}</div>
            </div>
          </div>

          <div className="h-px bg-[#f0ede8] mb-6" />
          <div className="text-[15px] font-semibold text-[#1a1a1a] mb-5">{t.login.access_account}</div>

          <form onSubmit={handleSubmit} autoComplete="off">
            <div className="mb-[15px]">
              <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-[.07em] mb-1.5">{t.login.user_label}</label>
              <input
                type="text" value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder={t.login.user_placeholder}
                className="w-full px-[14px] py-[11px] rounded-[11px] border-[1.5px] border-[#e8e4de] bg-[#FAFAF8] text-sm text-[#0f0f0f] font-mono outline-none transition-all focus:border-brand focus:bg-white"
                style={{ boxShadow: 'none' }}
                onFocus={e => { e.target.style.boxShadow = '0 0 0 3px rgba(255,98,0,.1)'; }}
                onBlur={e => { e.target.style.boxShadow = 'none'; }}
                autoComplete="off"
              />
            </div>
            <div className="mb-[15px]">
              <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-[.07em] mb-1.5">
                {t.login.password_label} <span className="font-normal text-[#d1cec9]">{t.login.password_hint}</span>
              </label>
              <input
                type="password" value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-[14px] py-[11px] rounded-[11px] border-[1.5px] border-[#e8e4de] bg-[#FAFAF8] text-sm text-[#0f0f0f] font-mono outline-none transition-all focus:border-brand focus:bg-white"
                style={{ boxShadow: 'none' }}
                onFocus={e => { e.target.style.boxShadow = '0 0 0 3px rgba(255,98,0,.1)'; }}
                onBlur={e => { e.target.style.boxShadow = 'none'; }}
                autoComplete="off"
              />
            </div>
            <div className={`text-xs text-red-500 text-center min-h-[16px] mb-1.5 transition-opacity ${error ? 'opacity-100' : 'opacity-0'}`}>
              {error || '\u00A0'}
            </div>
            <button
              type="submit" disabled={submitting}
              className="w-full py-[13px] rounded-[12px] border-none text-white text-sm font-bold tracking-[.02em] cursor-pointer relative overflow-hidden transition-all"
              style={{
                background: 'linear-gradient(135deg, #FF6200, #E05200)',
                boxShadow: '0 4px 14px rgba(255,98,0,.25)',
                opacity: submitting ? 0.6 : 1,
              }}
            >
              {submitting ? (
                <span className="flex items-center justify-center gap-1">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-white animate-[db_1.2s_infinite_ease-in-out_both]" style={{ animationDelay: '-.32s' }} />
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-white animate-[db_1.2s_infinite_ease-in-out_both]" style={{ animationDelay: '-.16s' }} />
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-white animate-[db_1.2s_infinite_ease-in-out_both]" />
                </span>
              ) : t.login.enter_btn}
            </button>
          </form>

          {/* Quick access chips */}
          <div className="mt-[22px] pt-[18px] border-t border-[#f0ede8]">
            <div className="text-[10px] text-[#c4c0bb] text-center uppercase tracking-[.1em] mb-2.5">{t.login.quick_access}</div>
            <div className="flex gap-1.5 justify-center flex-wrap">
              {[
                { name: 'Ana Silva', user: 'ana.silva' },
                { name: 'Carlos Mendes', user: 'carlos.mendes' },
                { name: 'Beatriz Lima', user: 'beatriz.lima' },
              ].map(({ name, user }) => (
                <button
                  key={user}
                  onClick={() => quickLogin(user)}
                  className="text-[11px] text-gray-500 border-[1.5px] border-[#e8e4de] rounded-full px-[13px] py-1 cursor-pointer font-mono transition-all bg-white hover:border-brand hover:text-brand hover:bg-[#fff8f4] hover:-translate-y-px"
                  style={{ boxShadow: 'none' }}
                  onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 2px 8px rgba(255,98,0,.12)'; }}
                  onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; }}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>

          {/* Language switcher */}
          <div className="flex items-center justify-center gap-2 mt-5 pt-4 border-t border-[#f0ede8]">
            <button
              onClick={() => setLang('pt')}
              className={`text-[11px] font-bold px-3 py-1.5 rounded-lg transition-colors ${lang === 'pt' ? 'bg-orange-50 text-orange-600 border border-orange-200' : 'text-gray-400 hover:text-gray-600'}`}
            >
              🇧🇷 PT
            </button>
            <button
              onClick={() => setLang('es')}
              className={`text-[11px] font-bold px-3 py-1.5 rounded-lg transition-colors ${lang === 'es' ? 'bg-orange-50 text-orange-600 border border-orange-200' : 'text-gray-400 hover:text-gray-600'}`}
            >
              🇪🇸 ES
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
