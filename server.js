// GLOBAL ONLINE PLAYER COUNT
setInterval(() => {
  const onlineCount = [...players.values()]
    .filter(p => p.ws && p.ws.readyState === WebSocket.OPEN)
    .length;

  for (const p of players.values()) {
    send(p.ws, {
      type: 'online-count',
      count: onlineCount
    });
  }
}, 2000);