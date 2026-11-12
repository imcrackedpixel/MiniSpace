
/* MINISPACE - PEACEFUL TRADE & SOCIAL HUB */

(function () {
  const tradeStationImage = new Image();
  tradeStationImage.src = 'Station_trade.png';

  window.MINISPACE_TRADE_HUB = {
    id: 'public_trade_hub',
    size: 7000,
    centerX: 3500,
    centerY: 3500,

    station: {
      x: 3500,
      y: 3500,
      radius: 450,

      draw(ctx) {
        const x = this.x;
        const y = this.y;

        ctx.save();
        ctx.translate(x, y);

        if (
          tradeStationImage.complete &&
          tradeStationImage.naturalWidth > 0
        ) {
          ctx.drawImage(
            tradeStationImage,
            -450,
            -300,
            900,
            600
          );
        } else {
          // Teal fallback while the image loads
          ctx.shadowColor = '#36b99a';
          ctx.shadowBlur = 28;
          ctx.strokeStyle = '#36b99a';
          ctx.lineWidth = 18;
          ctx.beginPath();
          ctx.ellipse(0, 0, 430, 260, 0, 0, Math.PI * 2);
          ctx.stroke();
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
