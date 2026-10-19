// Share image, 1080x1920 (story size), drawn on a canvas. Loaded on demand.
// Same look as the game: navy sky, gold solved floors, blue «أنت هنا» frame.

const W = 1080;
const H = 1920;
const FONT = '"IBM Plex Sans Arabic", "Segoe UI", Tahoma, sans-serif';

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
}

export async function makeShareImage({ solved, reached, total, url }) {
  try {
    await Promise.all([document.fonts.load(`700 120px ${FONT}`), document.fonts.load(`400 48px ${FONT}`)]);
  } catch {}
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';

  // Sky: navy with a blue glow at the top
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0.3, '#090D27');
  sky.addColorStop(1, '#060818');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.scale(1, 0.5);
  const glow = ctx.createRadialGradient(W / 2, 0, 0, W / 2, 0, 900);
  glow.addColorStop(0, 'rgba(35,47,105,1)');
  glow.addColorStop(1, 'rgba(35,47,105,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, 1800);
  ctx.restore();
  let seed = 7; // fixed stars so every image looks the same
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  ctx.fillStyle = '#fff';
  for (let i = 0; i < 50; i++) {
    ctx.globalAlpha = 0.2 + rnd() * 0.5;
    ctx.beginPath();
    ctx.arc(rnd() * W, rnd() * H * 0.7, rnd() * 2 + 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Headline
  const done = solved >= total;
  ctx.fillStyle = '#FFCF6B';
  ctx.font = `700 72px ${FONT}`;
  ctx.fillText('البرج', W / 2, 190);
  ctx.fillStyle = '#F2F4FA';
  ctx.font = `700 100px ${FONT}`;
  ctx.fillText(done ? 'وصلت القمة!' : solved > 0 ? `وصلت الطابق ${reached}` : 'هل تصل القمة؟', W / 2, 350);
  ctx.fillStyle = '#B9BED3';
  ctx.font = `400 52px ${FONT}`;
  ctx.fillText('هل تقدر تسبقني؟', W / 2, 440);

  // Tower: up to 11 floors, keeping the player near the top
  const shown = Math.min(total, 11);
  const last = Math.min(total, Math.max(shown, solved + 3));
  const first = last - shown + 1;
  const fh = 76;
  const gap = 18;
  const tw = 520;
  const x = (W - tw) / 2;
  const baseY = 1600;
  const label = (n, side, y) => {
    ctx.font = `700 36px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText(`الطابق ${n}`, x + tw - 34, y);
    ctx.textAlign = 'left';
    ctx.fillText(side, x + 34, y);
    ctx.textAlign = 'center';
  };
  for (let i = 0; i < shown; i++) {
    const n = first + i;
    const y = baseY - (i + 1) * (fh + gap);
    const ty = y + fh / 2 + 13;
    if (n <= solved) {
      const g = ctx.createLinearGradient(x + tw, 0, x, 0);
      g.addColorStop(0, '#FED786');
      g.addColorStop(1, '#F6B946');
      ctx.fillStyle = g;
      rr(ctx, x, y, tw, fh, 16);
      ctx.fill();
      ctx.fillStyle = '#2A1800';
      label(n, '✓', ty);
    } else if (n === solved + 1) {
      ctx.fillStyle = '#0F1640';
      rr(ctx, x, y, tw, fh, 16);
      ctx.fill();
      ctx.save();
      ctx.shadowColor = 'rgba(122,162,255,.8)';
      ctx.shadowBlur = 36;
      ctx.strokeStyle = '#7AA2FF';
      ctx.lineWidth = 5;
      rr(ctx, x - 16, y - 8, tw + 32, fh + 16, 20);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#fff';
      label(n, 'أنا هنا', ty);
    } else {
      ctx.fillStyle = '#141A38';
      rr(ctx, x, y, tw, fh, 16);
      ctx.fill();
      ctx.setLineDash([10, 8]);
      ctx.strokeStyle = '#1F2858';
      ctx.lineWidth = 2;
      rr(ctx, x, y, tw, fh, 16);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#5F6688';
      label(n, 'مقفل', ty);
    }
  }
  // Roof
  const topY = baseY - shown * (fh + gap);
  if (done) {
    const g = ctx.createLinearGradient(0, topY - 110, 0, topY);
    g.addColorStop(0, '#FED786');
    g.addColorStop(1, '#F6B946');
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = '#141A38';
  }
  ctx.beginPath();
  ctx.moveTo(W / 2, topY - 120);
  ctx.lineTo(x + tw + 20, topY - 8);
  ctx.lineTo(x - 20, topY - 8);
  ctx.closePath();
  ctx.fill();

  // Footer
  ctx.fillStyle = '#F2F4FA';
  ctx.font = `700 46px ${FONT}`;
  ctx.fillText('العب الآن', W / 2, 1730);
  ctx.direction = 'ltr';
  ctx.fillStyle = '#7AA2FF';
  ctx.font = `400 42px ${FONT}`;
  ctx.fillText(url.replace(/^https?:\/\//, '').replace(/\/$/, ''), W / 2, 1796);
  ctx.fillStyle = '#8488A0';
  ctx.font = `400 32px ${FONT}`;
  ctx.fillText('NovaX Lab', W / 2, 1858);

  return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
}
