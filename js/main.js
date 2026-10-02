import * as THREE from 'three';
import { Juego } from './game.js';

/**
 * Engine y bucle. Este es el unico archivo que crea el renderer, la camara y
 * las luces, y el unico que llama a requestAnimationFrame. game.js no sabe nada
 * de three: solo recibe la escena.
 */

const PASO_FIJO = 1 / 120;
const DELTA_MAXIMO = 0.25;

const lienzo = document.getElementById('lienzo');

const renderer = new THREE.WebGLRenderer({ canvas: lienzo, antialias: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;

const escena = new THREE.Scene();
escena.background = new THREE.Color(0x4aa8e0);
escena.fog = new THREE.Fog(0x7fc4ea, 60, 165);

const camara = new THREE.PerspectiveCamera(62, 1, 0.1, 400);
camara.position.set(0, 4.6, 8.6);
camara.lookAt(0, 1.1, -12);

// Luz hemiferica para el ambiente + direccional para las sombras. Con las luces
// fisicamente correctas por defecto hay que subir las intensidades: no existe
// useLegacyLights que compense.
escena.add(new THREE.HemisphereLight(0xcfe9ff, 0x6f8f4a, 2.1));

const sol = new THREE.DirectionalLight(0xfff4e0, 2.6);
sol.position.set(14, 22, 10);
sol.castShadow = true;
sol.shadow.mapSize.set(2048, 2048);
// Frustum ortografico alineado con la luz (que mira a juego.x, 0, -10). Los
// limites estan en el espacio de esa camara, no en el del mundo: por eso van
// generosos. Un frustum pequeno es la causa clasica de "la pista no tiene
// sombra", porque los obstaculos del juego quedan fuera del mapa de sombras.
sol.shadow.camera.left = -34;
sol.shadow.camera.right = 34;
sol.shadow.camera.top = 46;
sol.shadow.camera.bottom = -46;
sol.shadow.camera.near = 1;
sol.shadow.camera.far = 140;
// normalBias separa la sombra de la superficie en vez de desplazarla en la
// luz: corrige el acne sin desprender la sombra del objeto que la proyecta.
sol.shadow.bias = -0.0006;
sol.shadow.normalBias = 0.035;
escena.add(sol);
escena.add(sol.target);

const juego = new Juego(escena, lienzo);

function redimensionar() {
  const ancho = window.innerWidth;
  const alto = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(ancho, alto, false);
  camara.aspect = ancho / alto;
  camara.updateProjectionMatrix();
}

window.addEventListener('resize', redimensionar);
redimensionar();

// Los rAF se detienen en background: sin esto, al volver a la pestaña el delta
// acumulado teleportaria al jugador a traves de los obstaculos.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) juego.pausar();
});

const reloj = new THREE.Clock();
let acumulador = 0;

function bucle() {
  requestAnimationFrame(bucle);

  acumulador += Math.min(reloj.getDelta(), DELTA_MAXIMO);
  while (acumulador >= PASO_FIJO) {
    juego.actualizar(PASO_FIJO);
    acumulador -= PASO_FIJO;
  }

  // La camara sigue al jugador en X con retardo: da sensacion de inercia lateral.
  camara.position.x += (juego.jugador.x * 0.55 - camara.position.x) * 0.08;
  sol.target.position.set(juego.jugador.x, 0, -10);

  renderer.render(escena, camara);
}

bucle();
