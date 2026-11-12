
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
      radius: 900,

      draw(ctx) {
        ctx.save();
        ctx.translate(this.x, this.y);

        if (
          tradeStationImage.complete &&
          tradeStationImage.naturalWidth > 0
        ) {
          ctx.drawImage(
            tradeStationImage,
            -900,
            -600,
            1800,
            1200
          );
        } else {
          ctx.shadowColor = '#36b99a';
          ctx.shadowBlur = 28;
          ctx.strokeStyle = '#36b99a';
          ctx.lineWidth = 18;
          ctx.beginPath();
          ctx.ellipse(0, 0, 860, 520, 0, 0, Math.PI * 2);
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
