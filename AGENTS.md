# TBS RUNNER — Runner 3D

Proyecto de la asignatura **d3 — Aplicaciones de Diseño** del
**Instituto Técnico Boliviano Suizo — Potosí**.

Juego tipo runner en tercera persona. **Solo HTML, CSS y JavaScript puro** con three.js.
No hay bundler, no hay npm, no hay build step, no hay framework de UI, no hay tests automatizados.

## Idioma

Todo en español: conversación, commits, comentarios, nombres de archivo y documentación.
Código, identificadores y mensajes de error también en español salvo nombres de la API de three.js.

## Cómo ejecutar

Los ES modules **no funcionan con `file://`** (CORS). Hay que servir por HTTP:

```bash
python -m http.server 8000     # o: npx serve .
```

Luego abrir `http://localhost:8000`. No hay paso de compilación: recargar es el ciclo de desarrollo.
Los cambios en un módulo a veces quedan cacheados — recarga forzada si el comportamiento no cambia.

## Estructura

```
index.html          # import map + canvas + HUD (DOM del juego, fuera del canvas)
css/style.css
js/main.js          # entrypoint: engine (renderer, cámara, luces) y loop; único dueño del rAF
js/game.js          # máquina de estados del juego (menú, jugando, pausa, game over)
js/player.js
js/world.js         # pista, scrolling, generación de obstáculos
js/obstacles.js     # tipos de obstáculo + pool
js/input.js         # teclado/táctil -> acciones
js/hud.js           # DOM del HUD, se actualiza por evento, no por frame
```

Un módulo = una responsabilidad. `main.js` es el único que crea el engine y dispara
`requestAnimationFrame`; el resto exporta clases o funciones y recibe lo que necesitan por
constructor. Nada de estado global compartido: cada módulo expone su estado.

Los módulos que **construyen objetos 3D** (`player.js`, `world.js`, `obstacles.js`) sí importan
three — necesitan sus constructores. La regla es sobre el **engine y el loop**, no sobre el import.

## three.js — lo que se rompe por ignorarlo

- **Import map con versión exacta pineada**, nunca `@latest` ni rango abierto. Romper APIs entre
  versiones es el fallo más común de este proyecto:
  ```html
  <script type="importmap">
  { "imports": {
      "three": "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js",
      "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/"
  }}
  </script>
  ```
  Si se actualiza three.js, se actualizan las dos entradas juntas y se revalida todo.
- Es `outputColorSpace = THREE.SRGBColorSpace`. `outputEncoding` **ya no existe**.
- `useLegacyLights` **ya no existe**: las luces son*físicamente correctas* por defecto. Compensar
  intensidades, no activar flags de compatibilidad.
- Texturas de color: `texture.colorSpace = THREE.SRGBColorSpace`. Las de datos (normal, roughness)
  se dejan en `NoColorSpace`. Marcarlo mal se ve como colores lavados y es difícil de debuggear.
- Todo objeto debe estar agregado a la escena (directamente o como hijo) para que su matriz se
  actualice. Un mesh fuera de la escena no se mueve.
- Al crear geometrías, materiales o texturas en runtime hay que llamarlos. `dispose()` al
  reemplazarlos, o la memoria de video se filtra hasta que se traba el juego.
- `renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))` en el arranque y en cada resize,
  junto con `renderer.setSize` y `camera.aspect` + `updateProjectionMatrix()`.

## Game loop y física

- **Paso fijo con acumulador**, nunca integrar con el delta crudo. A FPS bajos el jugador atraviesa
  obstáculos (*tunneling*):
  ```js
  const FIXED = 1 / 120;
  let acc = 0;
  acc += Math.min(clock.getDelta(), 0.25);  // clamp: pestaña en background / breakpoint
  while (acc >= FIXED) { update(FIXED); acc -= FIXED; }
  render();
  ```
- El clamp del delta es obligatorio. Sin él, volver a la pestaña tras alt-tab teletransporta al jugador.
- **Manejar `visibilitychange`** para pausar: los `requestAnimationFrame` se detienen en background.
- Colisión por **AABB con chequeo barrido** (intervalo del frame anterior vs. actual), no por
  raycast. Es un runner de corredor recto: elraycast es sobreingeniería y más caro.
- `event.code` para teclas, no `event.key` — el layout del teclado del usuario no debe cambiar
  los controles. Prevenir el scroll con `preventDefault()` solo en las teclas del juego.

## Performance

Objetivo: 60 FPS estable.

- **Pooling obligatorio** para obstáculos y monedas. Se reciclan con `visible = false`;
  `scene.add()` / `remove()` por frame causa GC y tirones. Crear objetos en el loop es un bug,
  aunque "solo sea uno".
- **Nada de `new THREE.Vector3()` dentro del loop.** Usar vectores temporales a nivel de módulo y
  `clone()`/`copy()` cuando haga falta.
- Instanciar con `InstancedMesh` si se repite un patrón; el shader por objeto no escala.
- `frustumCulled` sirve, pero con el pool hay que actualizar la matriz de instancia al reciclar.

## Frontend

- El HUD (puntos, distancia, menú, pausa) es **DOM normal**, no objetos three.js. Es más barato,
  accesible y estilable con CSS.
- Actualizar el HUD **por evento**, no en cada frame.
- El `canvas` ocupa el viewport; nada de layout de página alrededor. `touch-action: none` para que
  el táctil no scrollee durante el juego.
- Sin scroll ni overflow: es un juego a pantalla completa.

## Controles

- Teclado: ↑ saltar, ↓ deslizarse (mantenido), ←/→ cambiar de carril, Espacio turbo (mantenido), Esc/P pausa.
- Táctil: swipe arriba o tap/doble tap en mitad superior -> saltar; mantener en mitad superior -> turbo; swipe abajo -> deslizar (300 ms); swipe lateral -> cambiar de carril.


## Verificación

No hay suite de tests. Antes de dar por terminado un cambio:

1. `python -m http.server 8000` y abrir en el navegador.
2. Consola del navegador **sin errores ni warnings de three.js**.
3. Jugar de verdad: correr, saltar, esquivar, morir, reiniciar, morir otra vez.
4. Redimensionar la ventana y probar con la pestaña en background.
5. **Probar la pérdida de frames** (DevTools → Performance → CPU 4x slowdown): si el juego se rompe
   o el jugador atraviesa obstáculos, falta el paso fijo.
6. Confirmar que no crece el uso de memoria en la consola de DevTools al repetir el ciclo de vida.

## Commits

Conventional Commits en español: `feat: ...`, `fix: ...`, `refactor: ...`.
El mensaje explica **por qué**, no el qué.