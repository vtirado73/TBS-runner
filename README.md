# TBS RUNNER

**Proyecto de la asignatura _d3 — Aplicaciones de Diseño_
del _Instituto Técnico Boliviano Suizo — Potosí_.**

Runner 3D en tercera persona para navegador. Corres por una pista infinita, esquivas
obstáculos, recoges monedas y aguantas el ritmo hasta que la velocidad te mate.

**Solo HTML, CSS y JavaScript puro** con three.js. Sin bundler, sin npm, sin paso de
build, sin framework de UI y sin tests automatizados. Recargar la página es el ciclo
de desarrollo.

---

## Cómo ejecutarlo

Los ES modules **no funcionan con `file://`** (el navegador los bloquea por CORS). Hay que
servir el proyecto por HTTP. **Sirve con el que tengas**, todos dan el mismo resultado:

```bash
python -m http.server 8000     # Python
npx serve .                    # Node
php -S localhost:8000          # PHP
```

En VS Code, la forma más cómoda es la extensión **Live Server**: clic derecho sobre
`index.html` → *Open with Live Server*. También vale cualquier hosting estático
(GitHub Pages, Netlify, Vercel) o un servidor local de Android/iOS para probar en el
teléfono: si el equipo y el móvil están en la misma red, abrir `http://IP-DE-TU-PC:8000`
desde el navegador del móvil.

Luego abrir `http://localhost:8000`.

Si un cambio en un módulo no se refleja, es caché del navegador: recarga forzada
(`Ctrl+Shift+R`).

---

## Controles

### Teclado

| Tecla | Acción |
| --- | --- |
| `↑` | Saltar |
| `↓` | Deslizarse (mantener pulsado) |
| `←` / `→` | Cambiar de carril |
| `Espacio` | Turbo (mantener pulsado), velocidad 2,5× |
| `Esc` / `P` | Pausa |

El desliz se sostiene mientras la tecla esté pulsada, también en el aire: puedes saltar
y llegar al suelo ya deslizándote para pasar bajo una viga.

### Táctil

| Gesto | Acción |
| --- | --- |
| Swipe arriba o tap en la mitad superior | Saltar |
| Doble tap en la mitad superior | Saltar |
| Mantener el toque en la mitad superior | Turbo |
| Swipe abajo | Deslizarse (duración fija de 300 ms) |
| Swipe lateral | Cambiar de carril |

Se usa un solo puntero activo a la vez, así que un gesto no se dispara dos veces. Los
umbrales de reconocimiento están en `js/input.js` (`UMBRAL_SWIPE`, `UMBRAL_MANTENIMIENTO`,
`UMBRAL_DOBLE_TAP`, `DURACION_GESTO`).

El menú muestra las instrucciones de teclado en dispositivos con puntero fino y las de
táctil en dispositivos táctiles. El criterio es el tipo de puntero
(`@media (pointer: coarse), (hover: none)`), no el ancho: una tablet en horizontal es
táctil aunque mida 1024 px, y una ventana de PC estrecha sigue siendo de teclado.

---

## Estructura

```
index.html          # import map, canvas y HUD (DOM del juego, fuera del canvas)
css/style.css
js/main.js          # engine: renderer, cámara, luces y bucle. Único dueño del rAF
js/game.js          # máquina de estados (menú, jugando, pausa, fin) y puntuación
js/player.js        # salto, desliz, turbo de caída, colisiones y animación
js/world.js         # pista, señalización, scrolling, cielo y árboles
js/obstacles.js     # tipos de obstáculo, monedas, avisos y generador con pool
js/input.js         # teclado y gestos táctiles -> acciones
js/hud.js           # HUD en DOM, actualizado por evento
```

Un módulo = una responsabilidad. `main.js` es el único que crea el engine y dispara
`requestAnimationFrame`; el resto exporta clases y recibe lo que necesita por
constructor. No hay estado global compartido: cada módulo expone el suyo.

Los módulos que **construyen objetos 3D** (`player.js`, `world.js`, `obstacles.js`) sí
importan three; el resto no.

---

## Física y reglas

### Paso fijo

El bucle integra con acumulador de paso fijo, nunca con el delta crudo:

```js
const PASO_FIJO = 1 / 120;
const DELTA_MAXIMO = 0.25;      // clamp: pestaña en background o breakpoint
```

A FPS bajos, integrar con el delta crudo hace que el jugador atraviese obstáculos
(*tunneling*). El clamp evita que volver a la pestaña teletransporte al jugador.

`visibilitychange` pausa la partida: los `requestAnimationFrame` se detienen en segundo
plano.

### Constantes del jugador (`js/player.js`)

| Constante | Valor | Significado |
| --- | --- | --- |
| `GRAVEDAD` | `-20` | m/s² |
| `VELOCIDAD_SALTO` | `7.5` | m/s |
| `VELOCIDAD_CAIDA_MAX` | `-30` | m/s, tope de caída |
| `ALTO` | `1.7` | m, altura de pie |
| `ALTO_DESLIZ` | `0.8` | m, altura deslizándose |
| `MEDIO_ANCHO` | `0.45` | m, medio ancho de la caja |
| `MEDIO_PROF` | `0.28` | m, medio fondo de la caja |
| `TIEMPO_CAMBIO_CARRIL` | `0.18` | s, el cambio de carril es interpolado |
| `BUFFER_SALTO` | `0.12` | s, buffer de entrada para saltar |

Altura real del salto: ~1,37 m (teórica 1,41 m con integración discreta). Se elige para
que el cono bajo sea un reto real y la viga alta exija agacharse.

**Caída rápida (dive).** Si el jugador pulsa `↓` mientras está en el aire, la velocidad
vertical se fuerza a `VELOCIDAD_CAIDA_MAX` en el sub-paso siguiente: baja el centro de
masa al instante y reduce el tiempo de vuelo. Sirve para reaccionar rápido a una viga
que se ve tarde. Solo acorta la bajada; no anula el impulso de subida.

### Velocidad y puntuación (`js/game.js`)

| Constante | Valor |
| --- | --- |
| `VELOCIDAD_INICIAL` | `12` m/s |
| `VELOCIDAD_MAXIMA` | `22` m/s |
| `FACTOR_TURBO` | `2.5` |
| `PUNTOS_POR_MONEDA` | `10` |
| `METROS_POR_PUNTO` | `1` |

El turbo multiplica la **simulación**, no solo la cámara: el mundo, los obstáculos y el
generador avanzan más rápido. Con turbo al máximo la simulación llega a 55 m/s; la
colisión por barrido está verificada a esa velocidad. El turbo se libera al morir, al
reiniciar y al pausar.

---

## Obstáculos

Tres tipos, en `js/obstacles.js`:

| Tipo | Tecla | Altura visual | Cómo se pasa |
| --- | --- | --- | --- |
| `BAJO` (cono) | — | hasta `0.55` m | saltando |
| `VOLADO` (viga) | — | desde `1.50` m | deslizándose o buceando |
| `MACIZO` (bloque) | — | hasta `3.0` m | cambiando de carril |

El macizo se prolonga `0.7` m por debajo del suelo (`HUNDIMIENTO`) y se hunde con
`offsetY`, para que quede clavado en el terreno en vez de posado encima. La caja de
colisión no cambia: la fija el envoltorio, de 0 a `3.0`. El cono aplica el mismo criterio
con un hundimiento de `0.25` m y sobresale `0.25` m por encima.

### Colisión

AABB con **chequeo barrido en X** (intervalo del frame anterior contra el actual), no por
raycast: es un corredor recto y el raycast es sobreingeniería y más caro. En Y **no** se
barrido a propósito: con paso fijo la caída máxima por sub-paso es 0,25 m, muy por debajo
de la altura de cualquier obstáculo, así que no hay tunneling; barrer en Y daría falsos
positivos al pasar por encima de un obstáculo bajo.

El contacto efectivo queda en ~0,62 m sobre el suelo para que el jugador muera cuando el
borde de la malla realmente toca su caja.

### Generador

La separación entre filas se define como **tiempo de reacción**, no como distancia fija:
un hueco constante en metros sería fracción de segundo a velocidad alta y la pista sería
injusta.

```js
const ventana = 0.85 - this.dificultad * 0.25;
return velocidad * ventana * (0.85 + this.azar() * 0.35);
```

Reglas por carril (`requisito`) evitan combinaciones impossibles (dos macizos seguidos sin
hueco, un volado justo tras un bajo). Si un carril queda ocupado, la fila se coloca en el
siguiente hueco libre: el ritmo no depende de cuántos carriles queden libres.

Todo el recycling es por pool con `visible = false`. No hay `scene.add()` / `remove()` por
frame.

---

## Señalización

- **Líneas del camino**: `7.6` m de ancho, tramos de `20` m, 9 tramos en scroll.
  Bordes y guías laterales continuas miden `0.22` m de ancho; los guiones centrales
  amarillos miden `0.8 × 2.6 × 0.06` m, cinco por tramo separados `4` m. Ese paso
  compensa que el guion sea más corto: con el paso viejo entre marca y marca quedaría un
  hueco de 1,4 m y la línea discontinua se leería como un fallo de ritmo.
- **Círculos de aviso**: disco blanco semitransparente (`RADIO_AVISO = 0.95`, opacidad
  `0.08`) sobre el carril del obstáculo, `0.75` s por delante. La distancia se fija al
  colocar el obstáculo y se conserva al frenar el mundo, así que el disco no salta durante
  la frenada tras morir.
- **Monedas**: en arco entre `1.05` y `1.75` m. El cilindro nace con su eje en `Y` (como
  una moneda tumbada sobre la mesa) y gira sobre `Y`, que es el giro horizontal pedido;
  el toro va tumbado con `rotation.x = Math.PI / 2` para rodear la cara plana. La caja de
  recogida usa la altura completa, así que el arco se puede recoger también saltando.

## Sombras

Mapa de sombras `2048²` con frustum ampliado (`[-34, 34]` en X, `[-46, 46]` en Y,
`far = 140`) para que la sombra del jugador siga siendo nítida cerca de la cámara. El
camino y el césped reciben sombra; `normalBias` ajustado para evitar *acne*.

`outputColorSpace = SRGBColorSpace`, `setPixelRatio(Math.min(devicePixelRatio, 2))` en el
arranque y en cada resize.

---

## Frontend

- El HUD (puntos, distancia, monedas, menú, pausa, game over) es **DOM normal**, no
  objetos three.js: más barato, accesible y estilable con CSS.
- El HUD se actualiza **por evento**, no en cada frame.
- `canvas` a pantalla completa, `touch-action: none` para que el táctil no scrollee, sin
  scroll ni overflow.
- Colores como variables CSS en `:root` (`--cielo`, `--amarillo`, `--verde`, ...).

---

## Verificación

No hay suite de tests. Antes de dar por terminado un cambio:

1. Servir por HTTP (cualquiera de los de la sección *Cómo ejecutarlo*) y abrir en el
   navegador.
2. Consola **sin errores ni warnings de three.js**.
3. Jugar de verdad: correr, saltar, esquivar, bucear en el aire, morir, reiniciar, morir
   otra vez.
4. Redimensionar la ventana y probar con la pestaña en background.
5. **Probar la pérdida de frames** (DevTools → Performance → CPU 4× slowdown): si el juego
   se rompe o el jugador atraviesa obstáculos, falta el paso fijo.
6. Confirmar que la memoria no crece al repetir el ciclo de vida.

Para lo que sí se puede automatizar sin un runner de tests, se usan páginas-arnés
temporales que importan los módulos reales, miden constantes o cuentan eventos en un
`data-*`, se abren en Chrome headless y se borran al terminar. Verifican geometría, física
y cableado de input; **el ajuste de dificultad sigue siendo una decisión de juego humana**.

---

## Commits

Conventional Commits en español: `feat:`, `fix:`, `refactor:`. El mensaje explica **por
qué**, no el qué.