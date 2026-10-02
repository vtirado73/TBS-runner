import * as THREE from 'three';

/**
 * Jugador: corre solo hacia adelante (el mundo se desplaza), y resuelve los
 * obstaculos con salto, desliz o cambio de carril.
 *
 * Calibres de la fisica. Son interdependent y no se tocan por separado:
 *   altura maxima del salto = VELOCIDAD_SALTO^2 / (2 * |GRAVEDAD|) = 1.41 m
 *   cono  llega a 0.55 m     -> el salto lo supera con ~0.45 s de margen util
 *   viga  arranca en 1.50 m  -> el salto NO llega a despejarla
 * Ese ultimo par es el que obliga a agacharse: si se sube la viga por debajo de
 * 1.41, el salto volveria a ser la solucion y habria que recalibrar. Si se baja
 * el cono por debajo de ~0.7, el salto deja de ser un reto. Ver REQUISITOS 3.3.
 */

export const CARRIL_X = [-2.2, 0, 2.2];

const GRAVEDAD = -20;
const VELOCIDAD_SALTO = 7.5;
const VELOCIDAD_CAIDA_MAX = -30;

const ALTO = 1.7;
const ALTO_DESLIZ = 0.8;
const MEDIO_ANCHO = 0.45;
// Semiprofundidad del jugador. Sumada a la del obstaculo define cuando choca:
// 0.4 + 0.49 = 0.89 m, o sea el golpe llegaba casi un metro antes de que las
// mallas se tocaran y se leia como colision anticipada. Con 0.28 el contacto
// ocurre cuando las cajas se solapan de verdad. El margen no puede bajar de
// ~0.45 en total: con turbo a 55 m/s el mundo avanza 0.46 m por sub-paso.
const MEDIO_PROF = 0.28;

const TIEMPO_CAMBIO_CARRIL = 0.18;
const BUFFER_SALTO = 0.12;

const TINTA = {
  camisa: 0x3aa0ff,
  pantalon: 0x2b4a6f,
  piel: 0xffd9a0,
  zapato: 0x2b2b2b,
};

export class Jugador {
  constructor() {
    this.carril = 1;
    this.x = CARRIL_X[1];
    this.y = 0;
    this.vy = 0;
    this.altura = ALTO;

    this.enElAire = false;
    this.deslizadorPulsado = false;
    this.deslizando = false;
    this.mezclaDesliz = 0;
    this.bufferSalto = 0;
    this.xAnterior = this.x;

    this.tAnimacion = 0;
    this.inclinacion = 0;
    this.muerto = false;
    this.caida = 0;
    this.grupo = this.crearMalla();
  }

  crearMalla() {
    const grupo = new THREE.Group();
    this.visual = new THREE.Group();
    grupo.add(this.visual);

    const material = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.85 });

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.8, 0.5), material(TINTA.camisa));
    torso.position.y = 1.15;
    this.visual.add(torso);

    const cabeza = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.46, 0.46), material(TINTA.piel));
    cabeza.position.y = 1.8;
    this.visual.add(cabeza);

    this.piernas = [];
    for (const lado of [-0.19, 0.19]) {
      const pierna = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.78, 0.3), material(TINTA.pantalon));
      pierna.position.set(lado, 0.39, 0);
      this.visual.add(pierna);
      this.piernas.push(pierna);
    }

    for (const lado of [-0.2, 0.2]) {
      const zapato = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.14, 0.42), material(TINTA.zapato));
      zapato.position.set(lado, 0.07, 0.05);
      this.visual.add(zapato);
    }

    this.visual.traverse((obj) => {
      if (obj.isMesh) obj.castShadow = true;
    });

    return grupo;
  }

  // ---------- Acciones ----------

  /** Pide salto. Si el buffer no se consume en un sub-paso, el salto se pierde. */
  saltar() {
    if (this.enElAire || this.muerto) return;
    this.bufferSalto = BUFFER_SALTO;
  }

  deslizar() {
    if (this.muerto) return;
    // Se marca la intencion aunque este en el aire: al aterrizar se agacha
    // solo, sin tener que volver a pulsar.
    this.deslizadorPulsado = true;
  }

  /** Suelta el desliz. La entrada lo llama al levantar la tecla. */
  soltarDesliz() {
    this.deslizadorPulsado = false;
  }

  cambiarCarril(dir) {
    if (this.muerto) return;
    const destino = this.carril + dir;
    if (destino < 0 || destino >= CARRIL_X.length) return;
    this.carril = destino;
  }

  // ---------- Simulacion ----------

  actualizar(dt, velocidad) {
    this.xAnterior = this.x;

    if (this.muerto) {
      this.animar(dt, 0);
      return;
    }

    // Salto: sale del buffer antes de integrar, para que el impulso sea
    // consistente sin importar en que sub-paso cayo la pulsacion.
    if (this.bufferSalto > 0 && !this.enElAire) {
      this.bufferSalto = 0;
      this.vy = VELOCIDAD_SALTO;
      this.enElAire = true;
      this.altura = ALTO;
    }
    if (this.bufferSalto > 0) this.bufferSalto = Math.max(0, this.bufferSalto - dt);

    if (this.enElAire) {
      // Caida rapida ("dive") al deslizarse en el aire. Presionar abajo mientras
      // se salta fuerza la velocidad vertical hacia la caida maxima inmediatamente.
      // Esto baja el centro de masa y acorta el tiempo de vuelo.
      if (this.deslizadorPulsado) {
        this.vy = VELOCIDAD_CAIDA_MAX;
      }

      this.vy += GRAVEDAD * dt;
      if (this.vy < VELOCIDAD_CAIDA_MAX) this.vy = VELOCIDAD_CAIDA_MAX;
      this.y += this.vy * dt;
      if (this.y <= 0) {
        this.y = 0;
        this.vy = 0;
        this.enElAire = false;
      }
    }

    // El desliz se sostiene mientras la tecla este pulsada, pero solo si hay
    // suelo: en el aire el jugador va de pie y no puede pasar bajo una viga.
    this.deslizando = this.deslizadorPulsado && !this.enElAire;
    this.altura = this.deslizando ? ALTO_DESLIZ : ALTO;
    // Cambio de carril interpolado. Un salto de carril instantaneo permitiria
    // "teletransportarse" a traves de un obstaculo macizo.
    const destinoX = CARRIL_X[this.carril];
    const diferencia = destinoX - this.x;
    if (diferencia !== 0) {
      const paso = (Math.abs(diferencia) / TIEMPO_CAMBIO_CARRIL) * dt * Math.sign(diferencia);
      this.x = Math.abs(paso) >= Math.abs(diferencia) ? destinoX : this.x + paso;
    }

    this.animar(dt, velocidad);
  }

  animar(dt, velocidad) {
    this.grupo.position.set(this.x, this.y, 0);
    this.tAnimacion += dt * velocidad;

    if (this.muerto) {
      // Se desploma de lado. No sigue corriendo: la zancada se detiene, que es
      // lo que hace legible que la partida termino.
      this.caida = Math.min(1, this.caida + dt * 3.2);
      this.visual.rotation.z = this.caida * 1.4;
      this.visual.rotation.x = 0;
      this.visual.position.y = -0.3 * this.caida;
      this.visual.scale.set(1, 1 - 0.25 * this.caida, 1);
      this.piernas[0].rotation.x = -0.3;
      this.piernas[1].rotation.x = 0.2;
      return;
    }

    // Estado vivo: la caida anterior pudo dejar el torso girado en Z.
    this.visual.rotation.z = 0;

    if (this.deslizando) {
      this.mezclaDesliz = Math.min(1, this.mezclaDesliz + dt * 12);
    } else {
      this.mezclaDesliz = Math.max(0, this.mezclaDesliz - dt * 9);
    }

    const m = this.mezclaDesliz;
    if (m > 0) {
      this.visual.scale.set(1, 1 - 0.55 * m, 1);
      this.visual.rotation.x = 0.4 * m;
      this.visual.position.y = -0.35 * m;
    } else {
      this.visual.scale.set(1, 1, 1);
      this.visual.rotation.x = 0;
      this.visual.position.y = 0;
    }
    this.inclinacion *= m > 0 ? 1 - 0.2 * m : 0.85;

    this.grupo.rotation.z = this.inclinacion;

    // Zancada. Se detiene en el aire: las piernas se quedan recogidas al saltar.
    if (this.enElAire) {
      this.piernas[0].rotation.x = -0.5;
      this.piernas[1].rotation.x = 0.35;
    } else {
      const zancada = Math.sin(this.tAnimacion) * 0.85;
      this.piernas[0].rotation.x = zancada;
      this.piernas[1].rotation.x = -zancada;
    }
  }

  /** Inclina el cuerpo hacia el lado del desplazamiento. */
  inclinar(dir) {
    this.inclinacion = dir * 0.22;
  }

  // ---------- Colision ----------

  /**
   * Choque contra una caja del mundo, en coordenadas de mundo.
   * El barrido es en X (el cambio de carril recorre el espacio entre dos
   * carriles, y hay que comprobar ambos). En Y no se barre a proposito: con
   * paso fijo la caida maxima por sub-paso es 0.25 m, muy por debajo de la
   * altura de cualquier obstaculo, asi que no hay tuneling. Barrer en Y daria
   * falsos positivos al pasar de largo por encima de un obstaculo bajo.
   */
  chocaCon(minX, minY, minZ, maxX, maxY, maxZ) {
    const x0 = Math.min(this.xAnterior, this.x) - MEDIO_ANCHO;
    const x1 = Math.max(this.xAnterior, this.x) + MEDIO_ANCHO;
    if (x1 < minX || x0 > maxX) return false;

    const y0 = this.y;
    const y1 = this.y + this.altura;
    if (y1 < minY || y0 > maxY) return false;

    return -MEDIO_PROF < maxZ && MEDIO_PROF > minZ;
  }

  /** Caja actual, para recoger monedas. */
  caja() {
    return {
      minX: this.x - MEDIO_ANCHO,
      maxX: this.x + MEDIO_ANCHO,
      minY: this.y,
      maxY: this.y + this.altura,
    };
  }

  get enElSuelo() {
    return !this.enElAire;
  }

  reiniciar() {
    this.carril = 1;
    this.x = CARRIL_X[1];
    this.xAnterior = this.x;
    this.y = 0;
    this.vy = 0;
    this.altura = ALTO;
    this.enElAire = false;
    this.deslizadorPulsado = false;
    this.deslizando = false;
    this.mezclaDesliz = 0;
    this.bufferSalto = 0;
    this.inclinacion = 0;
    this.muerto = false;
    this.caida = 0;
  }
}
