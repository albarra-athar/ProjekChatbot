import { defineConfig } from 'astro/config';

export default defineConfig({
  // server Astro boleh menerima koneksi dari luar (bukan cuma localhost)
  server: {
    host: true,
  },
  // setting Vite supaya mengizinkan host dari ngrok
  vite: {
    server: {
      // boleh host apa pun yang berakhiran .ngrok-free.dev
      allowedHosts: ['.ngrok-free.dev'],
    },
  },
});

