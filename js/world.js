import * as THREE from 'three';

/**
 * Escenario que se desplaza: camino con sus lineas amarillas, arboles a los
 * lados y nubes al fondo. Todo son pools que se reciclan al salir de camara.
 *
 * El jugador nunca se mueve en Z: es el mundo el que avanza hacia el. Eso hace
 * que el jugador este siempre en z = 0 y su caja sea estable para las colisiones.
 */

const ANCHO_CAMINO = 7.6;
const LARGO_TRAMO = 20;
const TRAMOS = 9;

// El borde del camino y las guias laterales comparten medida; los guiones
// centrales van aparte porque se pueden ajustar sin tocar las lineas del borde.
const ANCHOS = { linea: 0.22, guia: 0.22, guion: 0.8 };

// Largo del guion central. 4 m ocupaba medio tramo y las marcas se leian como
// bloques grandes; con 2.6 la direccion se sigue leyendo sin cargar el camino.
const LARGO_GUION = 2.6;

const TINTA = {
  camino: 0x7a7a7a,
  caminoBorde: 0x6a6a6a,
  amarillo: 0xffd400,
  verde: 0x37b24d,
  verdeOscuro: 0x2b8c3c,
  cafe: 0x6b4423,
  nube: 0xffffff,
  suelo: 0x5c9e46,
};

export class Mundo {
  constructor(escena, azar) {
    this.azar = azar;
    this.grupo = new THREE.Group();
    escena.add(this.grupo);

    this.tramos = [];
    this.arboles = [];
    this.nubes = [];

    this.crearSuelo();
    this.crearTramos();
    this.crearPoolsDeArboles();
    for (let i = 0; i < this.arboles.length; i++) this.repartirArboles(true, i);
    this.crearNubes();
  }

  crearSuelo() {
    const suelo = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.MeshStandardMaterial({ color: TINTA.suelo, roughness: 1 }),
    );
    suelo.rotation.x = -Math.PI / 2;
    suelo.position.y = -0.02;
    // Sin esto el cesped no recibe sombra: los obstaculos que quedan fuera del
    // camino aparecen recortados sobre el verde, sin apoyo.
    suelo.receiveShadow = true;
    this.grupo.add(suelo);
  }

  crearTramos() {
    const gris = new THREE.MeshStandardMaterial({ color: TINTA.camino, roughness: 0.95 });
    const grisBorde = new THREE.MeshStandardMaterial({ color: TINTA.caminoBorde, roughness: 0.95 });
    const amarillo = new THREE.MeshStandardMaterial({ color: TINTA.amarillo, roughness: 0.9 });

    const geomCamino = new THREE.BoxGeometry(ANCHO_CAMINO, 0.2, LARGO_TRAMO);
    const geomLinea = new THREE.BoxGeometry(ANCHOS.linea, 0.06, LARGO_TRAMO);
    const geomGuia = new THREE.BoxGeometry(ANCHOS.guia, 0.06, LARGO_TRAMO);
    const geomGuion = new THREE.BoxGeometry(ANCHOS.guion, 0.06, LARGO_GUION);

    for (let i = 0; i < TRAMOS; i++) {
      const tramo = new THREE.Group();
      tramo.position.z = -i * LARGO_TRAMO;

      const camino = new THREE.Mesh(geomCamino, gris);
      camino.position.y = -0.1;
      camino.receiveShadow = true;
      tramo.add(camino);

      // Bordes del camino: separan visualmente la pista del cesped.
      for (const lado of [-1, 1]) {
        const borde = new THREE.Mesh(geomLinea, grisBorde);
        borde.position.set(lado * (ANCHO_CAMINO / 2 - 0.3), 0.01, 0);
        tramo.add(borde);
      }

      // Lineas amarillas: una guia continua a cada lado y guiones sueltos al centro,
      // que es lo que comunica la sensacion de velocidad al avanzar.
      for (const lado of [-1, 1]) {
        const guia = new THREE.Mesh(geomGuia, amarillo);
        guia.position.set(lado * (ANCHO_CAMINO / 2 - 0.9), 0.01, 0);
        tramo.add(guia);
      }
      // Guiones centrales. El paso baja de 5 a 4 m para compensar que el guion es
      // mas corto: si se deja el paso viejo, entre marca y marca queda un hueco
      // de 1.4 m y la linea discontinua se lee como un fallo de ritmo.
      for (let g = 0; g < 5; g++) {
        const guion = new THREE.Mesh(geomGuion, amarillo);
        guion.position.set(0, 0.01, -LARGO_TRAMO / 2 + 2 + g * 4);
        tramo.add(guion);
      }

      this.grupo.add(tramo);
      this.tramos.push(tramo);
    }
  }

  crearPoolsDeArboles() {
    const tronco = new THREE.MeshStandardMaterial({ color: TINTA.cafe, roughness: 1 });
    const copa = new THREE.MeshStandardMaterial({ color: TINTA.verde, roughness: 1 });
    const copaAlta = new THREE.MeshStandardMaterial({ color: TINTA.verdeOscuro, roughness: 1 });

    const geomTronco = new THREE.CylinderGeometry(0.16, 0.22, 1.1, 7);
    const geomCopa = new THREE.IcosahedronGeometry(0.95, 0);

    for (let i = 0; i < 34; i++) {
      const arbol = new THREE.Group();
      const alturaTronco = 0.8 + this.azar() * 0.6;
      const base = new THREE.Mesh(geomTronco, tronco);
      base.scale.y = alturaTronco;
      base.position.y = (alturaTronco * 1.1) / 2;
      base.castShadow = true;
      arbol.add(base);

      const copaMesh = new THREE.Mesh(geomCopa, this.azar() < 0.5 ? copa : copaAlta);
      copaMesh.position.y = alturaTronco * 1.1 + 0.5;
      copaMesh.scale.setScalar(0.85 + this.azar() * 0.5);
      copaMesh.castShadow = true;
      arbol.add(copaMesh);

      this.grupo.add(arbol);
      this.arboles.push(arbol);
    }

    for (let i = 0; i < this.arboles.length; i++) this.repartirArboles(true, i);
  }

  crearNubes() {
    const material = new THREE.MeshStandardMaterial({ color: TINTA.nube, roughness: 1 });
    const geometria = new THREE.IcosahedronGeometry(1, 0);

    for (let i = 0; i < 9; i++) {
      const nube = new THREE.Group();
      const trozos = 3 + Math.floor(this.azar() * 3);
      for (let t = 0; t < trozos; t++) {
        const trozo = new THREE.Mesh(geometria, material);
        trozo.position.set((this.azar() - 0.5) * 4, (this.azar() - 0.5) * 1.1, (this.azar() - 0.5) * 2);
        trozo.scale.setScalar(1.6 + this.azar() * 1.5);
        nube.add(trozo);
      }
      // Van fuera del recorrido del jugador: el cielo es decorado, no colisiona.
      nube.position.set((this.azar() - 0.5) * 110, 16 + this.azar() * 9, -60 - this.azar() * 90);
      this.grupo.add(nube);
      this.nubes.push(nube);
    }
  }

  /** Coloca un arbol en un carril lateral libre. `inicial` reparte toda la fila. */
  repartirArboles(inicial, indice = 0) {
    const arbol = this.arboles[indice % this.arboles.length];
    const lado = this.azar() < 0.5 ? -1 : 1;
    const distancia = 6.5 + this.azar() * 26;
    const z = inicial ? -indice * 11 - this.azar() * 6 : -120 - this.azar() * 25;
    arbol.position.set(lado * distancia, 0, z);
    const escala = 0.8 + this.azar() * 0.7;
    arbol.scale.setScalar(escala);
    arbol.rotation.y = this.azar() * Math.PI * 2;
  }

  actualizar(dt, velocidad) {
    const avance = velocidad * dt;

    for (let i = 0; i < this.tramos.length; i++) {
      const tramo = this.tramos[i];
      tramo.position.z += avance;
      if (tramo.position.z > 20) tramo.position.z -= TRAMOS * LARGO_TRAMO;
    }

    for (let i = 0; i < this.arboles.length; i++) {
      const arbol = this.arboles[i];
      arbol.position.z += avance;
      if (arbol.position.z > 25) this.repartirArboles(false, i);
    }

    // Las nubes se mueven mas despacio que el suelo: da sensacion de paralaje.
    for (const nube of this.nubes) {
      nube.position.z += avance * 0.12;
      if (nube.position.z > 40) {
        nube.position.z = -170 - this.azar() * 60;
        nube.position.x = (this.azar() - 0.5) * 110;
        nube.position.y = 16 + this.azar() * 9;
      }
    }
  }
}
