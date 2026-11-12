
/* MINISPACE - PEACEFUL TRADE & SOCIAL HUB */

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

      // Outer docking ring
      ctx.shadowColor = '#36b99a';
      ctx.shadowBlur = 28;
      ctx.strokeStyle = '#36b99a';
      ctx.lineWidth = 18;
      ctx.beginPath();
      ctx.ellipse(0, 0, 430, 260, 0, 0, Math.PI * 2);
      ctx.stroke();

      ctx.shadowBlur = 0;

      // Station body
      ctx.fillStyle = '#142b35';
      ctx.strokeStyle = '#8cebd0';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.roundRect(-250, -150, 500, 300, 55);
      ctx.fill();
      ctx.stroke();

      // Central command tower
      ctx.fillStyle = '#1d4650';
      ctx.strokeStyle = '#36b99a';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.roundRect(-95, -210, 190, 420, 35);
      ctx.fill();
      ctx.stroke();

      // Docking arms
      ctx.fillStyle = '#243e49';
      ctx.fillRect(-390, -55, 180, 110);
      ctx.fillRect(210, -55, 180, 110);

      // Glowing docking bays
      ctx.fillStyle = '#8cebd0';
      ctx.fillRect(-370, -25, 140, 50);
      ctx.fillRect(230, -25, 140, 50);

      // Station lights
      ctx.fillStyle = '#36b99a';
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.arc(i * 65, -95, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(i * 65, 95, 9, 0, Math.PI * 2);
        ctx.fill();
      }

      // Station name
      ctx.shadowColor = '#36b99a';
      ctx.shadowBlur = 15;
      ctx.fillStyle = '#b8fff0';
      ctx.font = 'bold 34px Courier New';
      ctx.textAlign = 'center';
      ctx.fillText('TRADE STATION', 0, 330);

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
