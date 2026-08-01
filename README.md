# HOTU · House of the Unknown

Sitio web reconstruido de cero (Next.js + Tailwind), inspirado en el diseño original.

## Qué ya está listo
- 8 páginas: Inicio, Noticias, Eventos, Artistas, Colectivos, Sets, Discografía, Tienda
- Sistema de 10 Distritos (título "DISTRITO 00-09" + subtítulo de género + color solo estético)
- Sistema visual "chrome" (concreto oscuro + gradientes metálicos por distrito)
- SEO base: metadata, Open Graph, sitemap.xml y robots.txt dinámicos
- Responsive (mobile / tablet / desktop)

## Qué falta (próximos pasos con Claude)
- Imágenes reales (logo, artistas, eventos, portadas) — guardarlas en `/public`
- Contenido real de cada sección (hoy tienen datos de ejemplo / placeholders)
- Conectar el newsletter a un servicio real (Mailchimp, Resend, etc.)
- Tienda funcional (checkout)

## Cómo correr el proyecto en tu computador

1. Instalá [Node.js](https://nodejs.org) (versión 20 o superior) si no lo tenés.
2. Abrí una terminal en esta carpeta y corré:
   ```bash
   npm install
   npm run dev
   ```
3. Abrí `http://localhost:3000` en el navegador.

## Cómo subir a GitHub

```bash
git init
git add .
git commit -m "Primer commit: HOTU desde cero"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/hotu.git
git push -u origin main
```

(Antes creá el repo vacío en https://github.com/new)

## Cómo publicar en Vercel con tu dominio

1. Entrá a https://vercel.com y conectá tu cuenta de GitHub.
2. "Add New Project" → elegí el repo `hotu`.
3. Vercel detecta Next.js automático, solo click en "Deploy".
4. Una vez publicado: **Settings → Domains** → agregá tu dominio propio y seguí las instrucciones de DNS que te da Vercel (agregar un registro en donde compraste el dominio).

Cada vez que hagas `git push`, Vercel vuelve a publicar el sitio solo.
