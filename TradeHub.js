
/* MINISPACE - TRADE & SOCIAL HUB
   Separate peaceful public area.
   Does not modify Station Loot or its NPCs.
*/

window.MINISPACE_TRADE_HUB = {
  id: 'public_trade_hub',
  size: 7000,
  centerX: 3500,
  centerY: 3500,

  gate: {
    x: 2500,
    y: 4200,
    radius: 100,

    draw(ctx) {
      ctx.save();

      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
      ctx.strokeStyle = '#36b99a';
      ctx.lineWidth = 5;
      ctx.shadowColor = '#36b99a';
      ctx.shadowBlur = 22;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius * 0.65, 0, Math.PI * 2);
      ctx.strokeStyle = '#8cebd0';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.shadowBlur = 0;
      ctx.fillStyle = '#8cebd0';
      ctx.font = 'bold 13px Courier New';
      ctx.textAlign = 'center';
      ctx.fillText('TRADE & SOCIAL HUB', this.x, this.y - this.radius - 18);

      ctx.font = '10px Courier New';
      ctx.fillText('SAFE ZONE · PVP DISABLED', this.x, this.y - this.radius - 4);

      ctx.restore();
    }
  },

  createWorld() {
    const belt = new AsteroidBelt(
      this.centerX,
      this.centerY,
      0,
      this.size
    );

    belt.generate(80, ['veldspar', 'scordite', 'pyroxeres']);

    const debris = typeof DebrisField !== 'undefined'
      ? new DebrisField(this.centerX, this.centerY, 1, this.size)
      : null;

    if (debris && typeof debris.generate === 'function') {
      debris.generate(1);
    }

    return {
      asteroidBelt: belt,
      debrisField: debris
    };
  }
};
