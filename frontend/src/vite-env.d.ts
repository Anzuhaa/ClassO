/// <reference types="vite/client" />

// Ambient module declarations so TypeScript accepts side-effect imports of
// stylesheets and other asset types bundled by Vite.
declare module '*.css'
declare module '*.svg' {
  const src: string
  export default src
}
declare module '*.png' {
  const src: string
  export default src
}
declare module '*.jpg' {
  const src: string
  export default src
}