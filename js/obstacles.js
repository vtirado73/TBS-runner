import * as THREE from 'three';
import { CARRIL_X } from './player.js';

/**
 * Pista: obstaculos y monedas. Todo sale de un pool y se recicla con
 * visible = false; crear o destruir objetos mientras se corre genera GC y tirones.
 *
 * Las tres clases de obstaculo estan calibradas contra la fisica de player.js
 * (ver REQUISITOS 3.3). Cada una tiene una unica solucion:
 *   bajo   -> saltar        (cima en 0.55, el salto llega a 1.41)
 *   volado -> agacharse     (arranca en 1.50, el salto no alcanza)
 *   macizo -> cambiar carril (altura completa, nada lo salva)
 */

const Z_RECICLAJE = 12;
// Horizonte de generacion. A 22 m/s, -150 da casi 7 s de aviso; con un umbral
// corto el jugador ve los obstaculos tarde y la pista se ve rala desde la camara.
const UMBRAL_GENERACION = -150;
const Z_CURSOR_INICIAL = -60;

const TINTA = {
  cono: 0xff7a1a,
  viga: 0xe8484c,
  bloque: 0x4a5b6b,
  bloqueCara: 0x37454f,
  moneda: 0xffcc00,
  monedaBorde: 0xd9a100,
};

export const TIPO = { BAJO: 'bajo', VOLADO: 'volado', MACIZO: 'macizo' };

const MEDIO_CARRIL = 0.8;
// Cuanto se hunde el macizo bajo el suelo. Solo afecta a la malla: la caja de
// colision no cambia, asi que ni el salto ni el cambio de carril se ven afectados.
const HUNDIMIENTO = 0.7;
const ALTO_BAJO = 0.55;
const MIN_VIGA = 1.5;
const ALTO_VIGA = 1.7;
const ALTO_MACIZO = 3.0;

// Altura de las monedas. 1.05 es el punto bajo del arco: por debajo de la
// cabeza (1.70) para no estorbar, pero claramente en el aire. El pico llega a
// ALTURA_MONEDA + ARCO_MONEDA = 1.75, que exige saltar.
const ALTURA_MONEDA = 1.05;
const ARCO_MONEDA = 0.7;

// Cuanto se retrasa el disco de aviso por delante del obstaculo. 0.75 s es el
// centro de la ventana de despegue del salto: si el jugador salta al pisarlo,
// llega al obstaculo en el punto mas alto del arco.
const RETRASO_AVISO = 0.75;

// Semiprofundidad del obstaculo. Con MEDIO_PROF del jugador (0.28) el contacto
// ocurre a 0.62 m del eje, que es donde las cajas se solapan de verdad.
const MEDIO_PROF_OBSTACULO = 0.34;

// Radio del circulo de aviso que precede a cada obstaculo. Se pone delante,
// sobre el carril, y el jugador salta al pisarlo: es la referencia que
// convierte "algo mas adelante" en "ahora".
const RADIO_AVISO = 0.95;
const ALTO_AVISO = 0.02;

class Envoltorio {
  constructor(mesh, tipo, minY, alto) {
    this.mesh = mesh;
    this.tipo = tipo;
    this.carril = 0;
    this.z = 0;
    this.minY = minY;
    this.alto = alto;
    this.medioProf = MEDIO_PROF_OBSTACULO;
    // Desplazamiento VISUAL en Y. Permite clavar la malla en el terreno sin
    // tocar la caja de colision. `colocar` pisa `mesh.position` entero, asi que
    // el offset tiene que guardarse aqui y aplicarse al colocar.
    this.offsetY = 0;
    // Distancia en metros entre el obstaculo y su disco de aviso. Se fija al
    // colocar y no se vuelve a tocar.
    this.retraso = 0;
    this.aviso = null;
    this.vivo = false;
  }

  colocar(carril, z, velocidad = 0) {
    this.carril = carril;
    this.z = z;
    this.retraso = velocidad * RETRASO_AVISO;
    this.mesh.position.set(CARRIL_X[carril], this.minY + this.alto / 2 + this.offsetY, z);
    this.mesh.visible = true;
    this.vivo = true;
  }

  /**
   * El aviso es un disco translucido en el suelo, POR DELANTE del obstaculo
   * (z mas negativo, hacia donde viene el jugador). Va por su cuenta en
   * actualizar: colgarlo del grupo del obstaculo lo descolocaria, porque cada
   * tipo centra su malla de forma distinta.
   */
  colocarAviso(malla) {
    this.aviso = malla;
    malla.visible = false;
  }

  ocultarAviso() {
    if (this.aviso) this.aviso.visible = false;
  }

  get minX() {
    return CARRIL_X[this.carril] - MEDIO_CARRIL;
  }

  get maxX() {
    return CARRIL_X[this.carril] + MEDIO_CARRIL;
  }

  get maxY() {
    return this.minY + this.alto;
  }
}

export class Pista {
  constructor(escena, azar) {
    this.grupo = new THREE.Group();
    escena.add(this.grupo);

    this.azar = azar;
    this.cursorZ = Z_CURSOR_INICIAL;
    this.dificultad = 0;
    this.vivos = [];
    this.poolBajo = [];
    this.poolVolado = [];
    this.poolMacizo = [];
    this.poolMonedas = [];
    this.reiniciarGenerador();

this.crearPools();
  }

  /** Disco de aviso, compartido por todos los obstaculos. */
  crearMaterialAviso() {
    return new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      // 0.08: un 75 % mas transparente que el 0.32 inicial. Es una marca de suelo,
      // no un elemento de juego; si tapa el asfalto deja de ser referenciable.
      opacity: 0.08,
      depthWrite: false,
    });
  }

  crearPools() {
    const opaco = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.8 });

    // Bajo: cono. Su silueta conicale se lee a distancia como "esto se salta".
    // La base es mas estrecha que la caja de colision (1.6 de ancho): el golpe
    // perdona un poco, que es lo esperable en un juego de reflejos.
    for (let i = 0; i < 14; i++) {
      // Igual que el macizo, la punta del cono sobresale ALTO_BAJO hacia arriba
      // desde el suelo: la cima visible sigue a 0.55, la caja no se mueve.
      const malla = new THREE.Mesh(
        new THREE.ConeGeometry(0.62, ALTO_BAJO + 0.25, 12),
        opaco(TINTA.cono),
      );
      malla.castShadow = true;
      malla.visible = false;
      this.grupo.add(malla);
      const ev = new Envoltorio(malla, TIPO.BAJO, 0, ALTO_BAJO);
      ev.offsetY = -0.25 / 2;
      this.poolBajo.push(ev);
    }

    // Volado: viga horizontal suspendida. Debajo se pasa agachado, por encima
    // no cabe ni de pie ni saltando.
    for (let i = 0; i < 10; i++) {
      const grupo = new THREE.Group();
      const viga = new THREE.Mesh(new THREE.BoxGeometry(MEDIO_CARRIL * 2, ALTO_VIGA, 0.8), opaco(TINTA.viga));
      viga.castShadow = true;
      grupo.add(viga);
      // El grupo se centra en MIN_VIGA + ALTO_VIGA/2, asi que la viga va en 0 y
      // el canto inferior en -ALTO_VIGA/2. Con el origen en el suelo, -ALTO_VIGA
      // lo dejaba medio metro por encima de donde toca.
      const borde = new THREE.Mesh(
        new THREE.BoxGeometry(MEDIO_CARRIL * 2 + 0.12, 0.18, 0.92),
        opaco(TINTA.bloqueCara),
      );
      borde.position.y = -ALTO_VIGA / 2 + 0.09;
      grupo.add(borde);

      // Pilares hasta el suelo. El grupo se coloca con su centro en MIN_VIGA +
      // ALTO_VIGA/2, asi que el suelo esta en -ESFUERZO_LOCAL y la viga arranca
      // en -ALTO_VIGA/2. Los postes quedan en los bordes, fuera del hueco de
      // paso: solo ancla visualmente, la caja de colision no los incluye.
      const sueloLocal = -(MIN_VIGA + ALTO_VIGA / 2);
      const altoPoste = -ALTO_VIGA / 2 - sueloLocal;
      for (const lado of [-1, 1]) {
        const poste = new THREE.Mesh(
          new THREE.BoxGeometry(0.18, altoPoste, 0.5),
          opaco(TINTA.bloqueCara),
        );
        poste.position.set(lado * (MEDIO_CARRIL - 0.09), sueloLocal + altoPoste / 2, 0);
        poste.castShadow = true;
        grupo.add(poste);
      }

      grupo.visible = false;
      this.grupo.add(grupo);
      this.poolVolado.push(new Envoltorio(grupo, TIPO.VOLADO, MIN_VIGA, ALTO_VIGA));
    }

    // Macizo: bloque de altura completa, el mas alto de la pista para que se
    // lea como "esto no se salva de ninguna otra forma".
    for (let i = 0; i < 12; i++) {
      const grupo = new THREE.Group();
      // El cuerpo se prolonga HUNDIDO bajo el suelo, y el hundimiento lo aplica
      // `offsetY` al colocar (no la malla: `colocar` pisa `position` entero).
      // Asi el bloque queda clavado en el terreno en vez de posado encima, que
      // es lo que hacia que pareciera flotar. La caja de colision no cambia: la
      // fija el Envoltorio, de 0 a ALTO_MACIZO.
      const cuerpo = new THREE.Mesh(
        new THREE.BoxGeometry(MEDIO_CARRIL * 2, ALTO_MACIZO + HUNDIMIENTO, 1.0),
        opaco(TINTA.bloque),
      );
      cuerpo.position.y = 0;
      cuerpo.castShadow = true;
      grupo.add(cuerpo);
      const tapa = new THREE.Mesh(new THREE.BoxGeometry(MEDIO_CARRIL * 2 + 0.14, 0.22, 1.14), opaco(TINTA.bloqueCara));
      tapa.position.y = ALTO_MACIZO / 2 - 0.1;
      grupo.add(tapa);
      grupo.visible = false;
      this.grupo.add(grupo);
      const ev = new Envoltorio(grupo, TIPO.MACIZO, 0, ALTO_MACIZO);
      ev.offsetY = -HUNDIMIENTO / 2;
      this.poolMacizo.push(ev);
    }

    // Monedas. El cilindro nace tumbado (eje en Y, como una moneda en la mesa) y
    // gira sobre Y: es el giro horizontal que se pide. El toro va tumbado
    // tambien para que el aro rodee la cara plana.
    for (let i = 0; i < 40; i++) {
      const malla = new THREE.Mesh(
        new THREE.CylinderGeometry(0.34, 0.34, 0.09, 16),
        new THREE.MeshStandardMaterial({ color: TINTA.moneda, metalness: 0.5, roughness: 0.3 }),
      );
      const borde = new THREE.Mesh(
        new THREE.TorusGeometry(0.3, 0.05, 8, 20),
        new THREE.MeshStandardMaterial({ color: TINTA.monedaBorde, metalness: 0.4, roughness: 0.4 }),
      );
      borde.rotation.x = Math.PI / 2;
      malla.add(borde);
      malla.castShadow = true;
      malla.visible = false;
      this.grupo.add(malla);
      const envoltorio = new Envoltorio(malla, 'moneda', 1.0, 0.09);
      envoltorio.rotacion = 0;
      this.poolMonedas.push(envoltorio);
    }

    this.crearAvisos();
  }

  /**
   * Pools de discos de aviso. Uno por obstaculo del pool, no uno compartido:
   * comparten material y geometria, y se recyclean con visible = false.
   */
  crearAvisos() {
    const material = this.crearMaterialAviso();
    const geometria = new THREE.CircleGeometry(RADIO_AVISO, 24);
    geometria.rotateX(-Math.PI / 2);

    for (const pool of [this.poolBajo, this.poolVolado, this.poolMacizo]) {
      for (const item of pool) {
        const disco = new THREE.Mesh(geometria, material);
        disco.renderOrder = 1;
        disco.visible = false;
        this.grupo.add(disco);
        item.colocarAviso(disco);
      }
    }
  }

  tomar(pool) {
    for (const item of pool) {
      if (!item.vivo) return item;
    }
    return null;
  }

  // ---------- Generacion ----------

  /**
   * Coloca obstaculos nuevos mientras el cursor alcance la zona visible.
   *
   * El cursor representa la posicion ACTUAL de la ultima fila colocada, y avanza
   * con el mundo a la misma velocidad que las filas. Si no avanzara con ellas, la
   * primera vez que se dispara dejaria un hueco al fondo para siempre. Por eso
   * `generar` recibe el avance y lo suma al cursor antes de decidir.
   *
   * Reglas de justicia (REQUISITOS 3.3): un macizo ocupa un carril entero, asi
   * que nunca se pone junto a otro macizo, y detras de el se deja margen para
   * que el jugador tenga tiempo a reaccionar.
   */
  generar(avance, velocidad) {
    this.cursorZ += avance;
    let colocadas = 0;
    while (this.cursorZ > UMBRAL_GENERACION && colocadas < 6) {
      // El z de la fila lo decide `soltarFila`: si un carril sigue ocupado, la
      // fila se coloca en el siguiente hueco libre en vez de quedarse sin poner.
      // Asi el ritmo de filas no depende de cuantos carriles queden libres.
      this.soltarFila(this.cursorZ, velocidad);
      this.cursorZ -= this.separacion(velocidad);
      colocadas++;
    }
  }

  /**
   * Separacion en metros, pero definida como tiempo de reaccion. A velocidad
   * alta, un hueco fijo en metros seria fraccion de segundo y la pista seria
   * injusta; asi el margen se mantiene comparable para el jugador.
   */
  separacion(velocidad) {
    // Con la ventana mas corta que antes, porque asegurarEspacio ya aparta filas
    // cuando un carril queda ocupado. El margen de seguridad lo pone la regla
    // por carril, no esta separacion: si no, la pista se espacia en vez de
    // repartirse entre los tres carriles.
    const ventana = 0.85 - this.dificultad * 0.25;
    return velocidad * ventana * (0.85 + this.azar() * 0.35);
  }

  soltarFila(z, velocidad) {
    const dado = this.azar();

    if (dado < 0.3 + this.dificultad * 0.1) {
      // Macizo: un solo carril bloqueado, los otros dos quedan libres.
      const carril = this.elegirCarril(TIPO.MACIZO, z, velocidad);
      if (carril >= 0) this.soltar(TIPO.MACIZO, carril, z, velocidad);
      return;
    }

    if (dado < 0.6) {
      // Volado: se puede pasar agachado en su carril o esquivarlo de lado.
      const carril = this.elegirCarril(TIPO.VOLADO, z, velocidad);
      if (carril >= 0) this.soltar(TIPO.VOLADO, carril, z, velocidad);
    } else {
      // Bajo: se salta, y se pueden poner dos en paralelo para exigir ritmo.
      const primero = this.elegirCarril(TIPO.BAJO, z, velocidad);
      if (primero >= 0) this.soltar(TIPO.BAJO, primero, z, velocidad);
      if (this.azar() < 0.35 + this.dificultad * 0.2) {
        const segundo = this.elegirCarril(TIPO.BAJO, z, velocidad, primero);
        if (segundo >= 0) this.soltar(TIPO.BAJO, segundo, z, velocidad);
      }
    }

    if (this.azar() < 0.5) this.soltarMonedas(z - velocidad * 0.5);
  }

  /**
   * Elige un carril donde quepa el obstaculo sin romper el margen del anterior.
   * Devuelve -1 si ninguno cumple. Buscar carril libre en vez de empujar la
   * fila hacia atras es lo que mantiene la pista densa: el ritmo de filas no
   * depende de cuantos carriles esten libres en cada momento.
   */
  elegirCarril(tipo, z, velocidad, evitar = -1) {
    const inicio = Math.floor(this.azar() * 3);
    for (let i = 0; i < 3; i++) {
      const carril = (inicio + i) % 3;
      if (carril === evitar) continue;
      if (this.hayEspacio(tipo, carril, z, velocidad)) return carril;
    }
    return -1;
  }

  /**
   * ¿Cabe un obstaculo de este tipo en este carril, a esta z?
   *
   * La distancia se mide contra la REFERENCIA del obstaculo anterior en el
   * carril, no contra la z en que se coloco: entre ambas el anterior se ha
   * desplazado con el mundo. Medirla en el momento de colocacion daria siempre
   * el mismo numero y los tres carriles se bloquearian a la vez.
   *
   * `referencia` es la z de colocacion; se le suma el avance acumulado para
   * obtener donde esta ahora mismo.
   */
  hayEspacio(tipo, carril, z, velocidad) {
    const previo = this.ultimoTipo[carril];
    if (!previo) return true;
    const ahora = this.ultimoZ[carril] + this.desplazamiento;
    const real = ahora - z;
    return real >= this.requisito(tipo, previo) * velocidad;
  }

  /**
   * Separacion minima, en SEGUNDOS, entre dos obstaculos seguidos en el mismo
   * carril. Es la regla de justicia general, y sale de la duracion de las
   * acciones del jugador:
   *
   *   bajo -> bajo   0.95 s   el salto dura 0.75 s en el aire: sin este margen
   *                            el jugador sigue volando cuando llega el segundo
   *                            cono y choca al caer.
   *   bajo -> volado 0.95 s   hay que aterrizar antes de poder agacharse.
   *   volado -> bajo 0.55 s   el agachado se abandona saltando antes de tiempo.
   *   macizo -> *    0.45 s   el cambio de carril tarda 0.18 s y hay que ver la fila.
   *
   * En segundos y no en metros: a velocidad alta un hueco fijo en metros seria
   * fraccion de segundo y la pista seria injusta.
   */
  requisito(tipo, previo) {
    if (!previo) return 0;
    if (previo === TIPO.BAJO && (tipo === TIPO.BAJO || tipo === TIPO.VOLADO)) return 0.95;
    if (previo === TIPO.MACIZO) return tipo === TIPO.MACIZO ? 0.7 : 0.45;
    if (previo === TIPO.VOLADO) return tipo === TIPO.BAJO ? 0.55 : 0.35;
    return 0.3;
  }

  soltar(tipo, carril, z, velocidad) {
    const pool = tipo === TIPO.BAJO ? this.poolBajo : tipo === TIPO.VOLADO ? this.poolVolado : this.poolMacizo;
    const item = this.tomar(pool);
    if (!item) return;
    item.colocar(carril, z, velocidad);
    this.vivos.push(item);
    this.ultimoTipo[carril] = tipo;
    this.ultimoZ[carril] = z;
  }

  /**
 * Monedas en arco. La altura NO es decorativa: el arco sube a 1.75 m, por
 * encima de la cabeza del jugador quieto (1.70), asi que la mayor parte de la
 * racha solo se recoge saltando. A 0.7 m se recogian solo passando por encima,
 * que es lo que hacia que parecieran tiradas en el suelo.
 */
soltarMonedas(z) {
    const carril = Math.floor(this.azar() * 3);
    const cantidad = 3 + Math.floor(this.azar() * 4);
    for (let i = 0; i < cantidad; i++) {
      const item = this.tomar(this.poolMonedas);
      if (!item) return;
      item.carril = carril;
      item.z = z - i * 1.8;
      item.minY = ALTURA_MONEDA + Math.sin((i / (cantidad - 1 || 1)) * Math.PI) * ARCO_MONEDA;
      item.mesh.position.set(CARRIL_X[carril], item.minY, item.z);
      item.mesh.rotation.y = item.rotacion;
      item.mesh.visible = true;
      item.vivo = true;
    }
  }

  // ---------- Simulacion ----------

  actualizar(dt, velocidad) {
    const avance = velocidad * dt;
    this.dificultad = Math.min(1, this.dificultad + dt * 0.02);
    // Cuanto ha avanzado el mundo desde el inicio: sirve para saber donde esta
    // hoy un obstaculo que se coloco en el pasado.
    this.desplazamiento += avance;

    for (let i = this.vivos.length - 1; i >= 0; i--) {
      const item = this.vivos[i];
      item.z += avance;
      item.mesh.position.z = item.z;

      // El aviso usa `item.retraso`, FIJADO al colocar el obstaculo, y no la
      // velocidad del frame. Con la velocidad viva, al morir la frenada la lleva
      // a cero y el disco se teletransportaba encima del obstaculo justo en el
      // impacto: de ahi que pareciera descolocado.
      if (item.aviso) {
        const zAviso = item.z - item.retraso;
        item.aviso.position.set(CARRIL_X[item.carril], ALTO_AVISO, zAviso);
        item.aviso.visible = zAviso < Z_RECICLAJE;
      }

      if (item.z > Z_RECICLAJE) {
        item.mesh.visible = false;
        item.ocultarAviso();
        item.vivo = false;
        this.vivos.splice(i, 1);
      }
    }

    for (const item of this.poolMonedas) {
      if (!item.vivo) continue;
      item.z += avance;
      item.rotacion += dt * 3.2;
      item.mesh.position.set(CARRIL_X[item.carril], item.minY, item.z);
      item.mesh.rotation.y = item.rotacion;
      if (item.z > Z_RECICLAJE) {
        item.mesh.visible = false;
        item.vivo = false;
      }
    }

    this.generar(avance, velocidad);
  }

  /**
   * Colisiones del jugador contra todo lo vivo. Devuelve true si choco, y
   * recoge las monedas que solapan. Recorre en reversa para poder quitar
   * monedas sin invalidar el indice de un elemento posterior.
   */
  resolver(jugador) {
    const caja = jugador.caja();
    let choco = false;
    let monedas = 0;

    for (const item of this.vivos) {
      if (
        jugador.chocaCon(
          item.minX,
          item.minY,
          item.z - item.medioProf,
          item.maxX,
          item.maxY,
          item.z + item.medioProf,
        )
      ) {
        choco = true;
      }
    }

    for (const item of this.poolMonedas) {
      if (!item.vivo) continue;
      const x = CARRIL_X[item.carril];
      const solapaX = caja.minX < x + 0.34 && caja.maxX > x - 0.34;
      const solapaY = caja.minY < item.minY + 0.34 && caja.maxY > item.minY - 0.34;
      const solapaZ = Math.abs(item.z) < 0.5 + item.medioProf;
      if (solapaX && solapaY && solapaZ) {
        item.mesh.visible = false;
        item.vivo = false;
        monedas++;
      }
    }

    return { choco, monedas };
  }

  reiniciar() {
    // Los avisos se ocultan aqui tambien: si no, `reiniciar` deja los discos
    // congelados en pantalla, porque viven fuera de `vivos`.
    for (const item of this.vivos) {
      item.mesh.visible = false;
      item.ocultarAviso();
      item.vivo = false;
    }
    this.vivos.length = 0;
    for (const item of this.poolMonedas) {
      item.mesh.visible = false;
      item.vivo = false;
    }
    this.cursorZ = Z_CURSOR_INICIAL;
    this.dificultad = 0;
    this.reiniciarGenerador();
  }

  /** Estado del generador de filas: el ultimo obstaculo puesto en cada carril. */
  reiniciarGenerador() {
    this.ultimoZ = [0, 0, 0];
    this.ultimoTipo = [null, null, null];
    this.desplazamiento = 0;
  }
}
