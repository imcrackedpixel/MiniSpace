
/* MINISPACE - PEACEFUL TRADE & SOCIAL HUB */

(function () {
  const tradeStationImage = new Image();
  // Resolve the art from the deployed site root rather than relying on the
  // current document route. This also makes the file path case explicit.
  tradeStationImage.src = new URL('./Station_trade.png', document.baseURI).href;
  tradeStationImage.onerror = function () {
    console.error('[MiniSpace] Could not load Trade Hub artwork:', tradeStationImage.src);
  };

  window.MINISPACE_TRADE_HUB = {
    id: 'public_trade_hub',
    size: 7000,
    centerX: 3500,
    centerY: 3500,

    station: {
      x: 3500,
      y: 3500,
      radius: 900,

      draw(ctx) {
        ctx.save();
        ctx.translate(this.x, this.y);

        // Draw only the station artwork; no oversized fallback ring or halo.
        if (tradeStationImage.complete && tradeStationImage.naturalWidth > 0) {
          ctx.drawImage(tradeStationImage, -900, -600, 1800, 1200);
        } else {
          // A clear temporary station graphic if the PNG is still loading or
          // unavailable; docking remains connected to this same station object.
          ctx.save();
          ctx.shadowColor = '#36b99a';
          ctx.shadowBlur = 30;
          ctx.strokeStyle = '#9be7d4';
          ctx.lineWidth = 24;
          ctx.beginPath();
          ctx.ellipse(0, 0, 760, 430, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = '#d7fff4';
          ctx.font = 'bold 110px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('TRADE HUB', 0, 0);
          ctx.restore();
        }

        ctx.restore();
      }
    },

    createWorld() {
      return {
        asteroidBelt: null,
        debrisField: null
      };
    }
  };
})();
