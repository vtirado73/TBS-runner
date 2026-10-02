# Requerimientos — TBS RUNNER

Proyecto de la asignatura **d3 — Aplicaciones de Diseño** del
**Instituto Técnico Boliviano Suizo — Potosí**.

Especificación funcional y de diseño del proyecto. Define **qué** construir; las convenciones
técnicas de implementación viven en [`AGENTS.md`](./AGENTS.md).

## 1. Identificación

| Campo | Valor |
|---|---|
| Nombre del sitio web | **TBS RUNNER** |
| Tipo | Juego web 3D en tercera persona (runner) |
| Objetivo principal | **Recreativo** |
| Público objetivo | Niños y adultos |
| Emoción a transmitir | Diversión |
| Emoción predominante | Alegría |
| Stack | HTML, CSS y JavaScript puro + three.js |

## 2. Concepto

Juego runner con objetos 3D. El jugador **corre sobre un camino, esquiva obstáculos y recoge
monedas** para sumar puntos. Experiencia arcade de partida rápida, sin Tutorial y con arranque
inmediato: el jugador entiende los controles en los primeros segundos jugando.

## 3. Alcance del juego

### 3.1 Bucle principal

1. El jugador corre automáticamente hacia adelante (el scroll simula el avance).
2. Superar obstáculos saltando, agachándose o cambiando de carril, y recoger monedas.
3. La distancia recorrida y las monedas se suman a la puntuación.
4. Un impacto con un obstáculo termina la partida.
5. La puntuación se muestra y el jugador puede reiniciar al instante.

### 3.2 Mecánicas requeridas

| Mecánica | Requisito |
|---|---|
| Correr automático | La velocidad base avanza sin input; el jugador no frena ni acelera. |
| **Saltar** | Mecánica central. Supera obstáculos bajos. |
| **Agacharse** | Pasar por debajo de obstáculos-volados. |
| **Cambiar de carril** | Esquivar obstáculos macizos por izquierda o derecha. |
| Recoger monedas | Sumar puntos; principal recompensa por skill. |
| Morir | Colisión con un obstáculo no superado termina la partida. |
| Reiniciar | Volver a jugar sin recargar la página. |

### 3.3 Tipos de obstáculo y cómo se superan

Cada obstáculo se resuelve con **una** de las tres acciones. Esta tabla es la especificación
literal del juego: si un obstáculo no encaja en una fila, está mal diseñado.

| Tipo | Ejemplo visual | Resolución | Insalvable |
|---|---|---|---|
| **Bajo** | Cono, charco, bordillo | **Saltar** (`↑`) | No |
| **Volado** | Viga, puente, puerta baja | **Agacharse** (`↓`) | No |
| **Macizo** | Bloque, Roca, árbol caído | **Cambiar de carril** (`←` / `→`) | **Sí** — el salto no lo supera |

Reglas que sostienen la tabla:

- Un obstáculo **bajo** no se puede pasar agachado, y un **volado** no se puede saltar: la altura
  del jugador y la del obstáculo son excluyentes. Cada clase tiene una única solución.
- Un **macizo** ocupa altura completa: ni el salto ni el agachado lo evitan. Es el único tipo que
  obliga a moverse de carril, y por eso exige haber leído la pista con antelación.
- Generar siempre **una solución por lo menos**; dos macizos en carriles contiguos, o un macizo
  seguido de un volado en el mismo carril, hacen la pista injusta.

### 3.4 Física del salto

- Arco balístico: velocidad vertical inicial + gravedad constante. **Sin impulso mientras se mantiene
  la tecla**: pulsar arriba repetidamente no da más altura.
- Gravedad aplicada en el **paso fijo** del bucle, nunca con el delta crudo. Es la razón principal por
  la que el salto debe integrarse dentro del acumulador (ver `AGENTS.md`).
- **No se puede saltar en el aire**: el segundo `↑` en pleno vuelo se ignora. Sin esto, el jugador
  encadena saltos y pierde el control del timing.
- **Buffer de salto**: si se pulsa `↑` unos frames antes de tocar suelo, el salto se ejecuta al
  aterrizar. Perder un salto por timing de frames se siente como un bug.
- Aterrizaje con velocidad vertical limitada: la caída se suaviza, no se teletransporta.

### Calibración de alturas

Estos cuatro números son **interdependientes**. Cambiar uno obliga a revisar los otros, y son
la causa más habitual de que el juego se sienta injusto o imposible.

| Valor | Número | Por qué |
|---|---|---|
| Altura del salto | 1.41 m (7.5 m/s con gravedad −20) | Marca la techo de lo franqueable. |
| Cono (bajo) | 0.55 m | Margen de despegue cómodo: ~0.45 s de anticipación útil. |
| Viga (volado) arranca en | 1.50 m | **Por encima del salto**: es lo que obliga a agacharse. |
| Caja agachado | 0.80 m | Cabe bajo la viga (1.50) y no bajo un macizo. |

Reglas que hay que mantener:

- Si la viga baja de 1.41 m, el salto vuelve a ser su solución y desaparece la mecánica de
  agacharse. Si el cono baja de ~0.5 m, el salto deja de ser un reto.
- La **ventana de despegue** (anticipación con la que un salto acierta) es el indicador que de
  verdad mide si el juego es justo: 0.45 s está bien; por debajo de 0.25 s exige reflejos
  imposibles. Es lo primero que hay que medir tras tocar estas alturas.
- Sin *coyote time*: el jugador nunca sale de una plataforma, así que no hay borde del que caerse
  y el concepto no aplica a este juego.

### 3.5 Colisiones

La colisión no es un booleano sino una **comparación de cajas**, y la caja del jugador cambia
según su estado. La regla general:

> El jugador sobrevive si, en el instante del impacto, sus tres estados posibles
> — **corriendo**, **saltando**, **agachado** —IPPno coinciden con la caja del obstáculo.

Reglas de resolución:

- **Corriendo**: colisión con cualquier obstáculo en su carril.
- **Saltando**: colisión solo con la parte del obstáculo que invade la franja vertical entre los
  pies del jugador y su altura actual. Al subir, se despeja; al bajar, vuelve a colisionar. Por eso
  la comprobación se hace **por sub-paso del paso fijo**, no una vez por frame.
- **Agachado**: la caja del jugador **se encoge en altura**, de modo que pasa bajo un volado y
  sigue chocando con un macizo.
- **Cambio de carril**: la transición lateral es interpolada, no instantánea. Durante el desplazamiento
  se comprueba la ocupación de **ambos** carriles de origen y destino, para que cambiar de carril no
  atraviese un macizo.
- Las **monedas** nunca matan: se recogen por solape de caja, sin importar el estado del jugador.
- Colisión por **AABB barrida** (intervalo del frame anterior vs. actual), no por raycast.

### 3.6 Generación de pista

- Scroll continuo: los segmentos de camino se reciclan al salir de cámara.
- La generación debe ser **aleatoria pero siempre justo** — nunca una combinación que deje al
  jugador sin salida (ver reglas en 3.3).
- La densidad y la velocidad **aumentan con la distancia** para sostener la dificultad.

### 3.4 Estados del juego

`menú` → `jugando` → `pausa` → `game over` → `menú`

- Menú inicial con la instrucción de controles.
- Pausa manual y automática al perder el foco de la pestaña.
- Game over mostrando puntuación y récord de la sesión.

## 4. Dirección de arte

### 4.1 Paleta

| Elemento | Color |
|---|---|
| Camino | **Gris** con **líneas amarillas** (señalización vial) |
| Árboles | **Verde** con **café** (copa + tronco) |
| Cielo | **Azul** con **nubes blancas** |
| Monedas | **Amarillas** |

### 4.2 Criterios

- Estética **low poly** y colores planos/sólidos: geometría simple, sin texturas ni PBR compleja.
  Es la vía más barata de mantener a 60 FPS y encaja con el tono recreativo.
- Fondo **azul con nubes blancas** → sensación de exterior luminoso, nunca opresivo.
- Las **monedas amarillas** sobre camino gris son el elemento de mayor contraste de la escena:
  deben leerse de un vistazo a distancia, que es exactamente cuando el jugador las ve.
- Las **líneas amarillas del camino** comunican velocidad y dirección de avance.
- Los **árboles verdes con tronco café** enmarcan el camino sin invadirlo.

### 4.3 Animación y feedback

- Rotación de la moneda sobre su eje: comunica que es un objeto dinámico y coleccionable.
- El jugador se inclina al esquivar y flexiona al saltar.
- Feedback al recoger moneda: destello breve y un sonido.
- Feedback claro al morir: la cámara frena y la pantalla de game over aparece.

### 4.4 HUD

- Puntuación y monedas siempre visibles, en **DOM sobre el canvas** (no objetos 3D).
- Tipografía grande y de alto contraste: el público incluye niños.
- Sin scroll, sin overflow, a pantalla completa. `touch-action: none` para móvil.

## 5. Controles

Controles **exclusivamente por flechas direccionales**. Se usan las cuatro direcciones; no hay que
especular otros atajos para "completar" el juego.

| Tecla | Acción | Obstáculo que resuelve |
|---|---|---|
| `↑` | **Saltar** | Bajo |
| `↓` | **Agachar / deslizarse** | Volado |
| `←` | Carril izquierdo | Macizo |
| `→` | Carril derecho | Macizo |

- `↑` no se puede usar en el aire (ver 3.4). `↓` se puede usar en cualquier momento.
- Mapa táctil: un `swipe` en la dirección equivalente ejecuta la misma acción. Tap en la parte
  superior de la pantalla = `↑`.
- Se registra por `event.code` (`ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`), no por
  `event.key`: el layout del teclado del usuario no debe cambiar los controles.

Detalle de implementación en [`AGENTS.md`](./AGENTS.md) (se usa `event.code`, no `event.key`).

## 6. Requisitos técnicos

- **Sin build step, sin bundler, sin dependencias de npm.** Solo HTML, CSS y JavaScript puro.
- three.js cargado por **import map** desde CDN, con **versión exacta pineada**.
- **Un solo `requestAnimationFrame`** en `main.js`; el resto de módulos exportan clases o funciones.
- **Paso fijo de física** con acumulador y clamp del delta (obligatorio: sin él, el jugador
  atraviesa obstáculos a FPS bajos).
- **Pooling** de obstáculos y monedas: cero asignaciones por frame.
- **HUD actualizado por evento**, nunca por frame.
- Redimensionado de ventana: `setSize`, `pixelRatio` y `aspect` de cámara.
- Compatibilidad con navegadores de escritorio y móvil.

## 7. Criterios de aceptación

- [ ] El juego carga por HTTP sin errores ni warnings de three.js en consola.
- [ ] Corre, salta, esquiva y recoge monedas con teclado y con táctil.
- [ ] Chocar con un obstáculo termina la partida y muestra la puntuación.
- [ ] Se reinicia sin recargar la página, y se puede volver a morir y reiniciar en bucle.
- [ ] El camino se hace infinito sin crecimiento de memoria ni caída de FPS.
- [ ] La puntuación sube con la distancia y con las monedas recogidas.
- [ ] La pausa funciona y también se pausa al cambiar de pestaña.
- [ ] Se mantiene la sensación de **diversión y alegría** que pide el objetivo del proyecto.


#### Telemetría visual
- **Círculo de aviso:** disco blanco semitransparente sobre el carril, colocado 0.75 s por delante de cada obstáculo (distancia fijada al colocar y constante incluso con frenada).
- **Monedas:** colocadas en arco a 1.05–1.75 m, girando horizontalmente sobre su eje Y.
