module.exports = {
  apps: [
    {
      name: "realtime-translator",
      script: "server.js",
      env: {
        NODE_ENV: "production",
        PORT: 3000
      }
    }
  ]
};
