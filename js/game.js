import { Jugador } from './player.js';
import { Pista } from './obstacles.js';
import { Mundo } from './world.js';
import { Hud } from './hud.js';
import { Entrada } from './input.js';

/**
 * Maquina de estados del juego. Es la unica que sabe en que estado estamos y
 * por lo tanto la unica que decide si el mundo avanza.
 *
 *   menu -> jugando -> pausa -> jugando
 *                    -> fin   -> jugando / menu
 */

const VELOCIDAD_INICIAL = 12;
const VELOCIDAD_MAXIMA = 22;
const METROS_POR_PUNTO = 1;
const PUNTOS_POR_MONEDA = 10;
const UMBRAL_HUD = 0.08;
// Turbo con espacio. Es un multiplicador de la VELOCIDAD DE SIMULACION, no de
// la de render: por eso el salto sigue dura 1.41 m y las colisiones no se
// atraviesan, pero el mundo llega antes.
const FACTOR_TURBO = 2.5;

export const ESTADO = {
  MENU: 'menu',
  JUGANDO: 'jugando',
  PAUSA: 'pausa',
  FIN: 'fin',
};

export class Juego {
  constructor(escena, lienzo) {
    this.azar = Math.random;
    this.jugador = new Jugador();
    this.pista = new Pista(escena, () => this.azar());
    this.mundo = new Mundo(escena, () => this.azar());
    this.hud = new Hud();

    escena.add(this.jugador.grupo);

    this.estado = ESTADO.MENU;
    this.distancia = 0;
    this.monedas = 0;
    this.puntos = 0;
    this.record = 0;
    this.acumuladorHud = 0;
    this.frenada = 0;
    this.turbo = false;

    this.entrada = new Entrada(lienzo);
    this.conectarControles();
    this.hud.conectar({
      jugar: () => this.empezar(),
      reiniciar: () => this.empezar(),
      seguir: () => this.reanudar(),
      pausa: () => this.pausar(),
      menu: () => this.alMenu(),
      salir: () => this.alMenu(),
    });

    this.hud.mostrar(ESTADO.MENU);
  }

  conectarControles() {
    this.entrada.on('salto', () => this.jugador.saltar());
    this.entrada.on('deslizar', () => this.jugador.deslizar());
    this.entrada.on('soltar-desliz', () => this.jugador.soltarDesliz());
    this.entrada.on('carril', (dir) => {
      this.jugador.cambiarCarril(dir);
      this.jugador.inclinar(dir);
    });
    this.entrada.on('pausa', () => {
      if (this.estado === ESTADO.JUGANDO) this.pausar();
      else if (this.estado === ESTADO.PAUSA) this.reanudar();
    });
    this.entrada.on('turbo', () => this.activarTurbo());
    this.entrada.on('soltar-turbo', () => this.soltarTurbo());
  }

  activarTurbo() {
    if (this.estado !== ESTADO.JUGANDO) return;
    this.turbo = true;
  }

  soltarTurbo() {
    this.turbo = false;
  }

  // ---------- Transiciones ----------

  empezar() {
    this.jugador.reiniciar();
    this.pista.reiniciar();
    this.soltarTurbo();
    this.distancia = 0;
    this.monedas = 0;
    this.puntos = 0;
    this.frenada = 0;
    this.acumuladorHud = UMBRAL_HUD;
    this.estado = ESTADO.JUGANDO;
    this.hud.mostrar(ESTADO.JUGANDO);
    this.pintarMarcadores();
  }

  pausar() {
    if (this.estado !== ESTADO.JUGANDO) return;
    this.estado = ESTADO.PAUSA;
    this.hud.mostrar(ESTADO.PAUSA);
  }

  reanudar() {
    if (this.estado !== ESTADO.PAUSA) return;
    this.estado = ESTADO.JUGANDO;
    this.hud.mostrar(ESTADO.JUGANDO);
  }

  alMenu() {
    this.estado = ESTADO.MENU;
    this.soltarTurbo();
    this.jugador.reiniciar();
    this.pista.reiniciar();
    this.hud.mostrar(ESTADO.MENU);
  }

  morir() {
    this.estado = ESTADO.FIN;
    this.jugador.muerto = true;
    this.jugador.soltarDesliz();
    this.soltarTurbo();
    this.frenada = 1;
    this.puntos = Math.floor(this.distancia) + this.monedas * PUNTOS_POR_MONEDA;
    const esRecord = this.puntos > this.record;
    if (esRecord) this.record = this.puntos;
    this.hud.resultado(this.puntos, this.monedas, esRecord);
    this.hud.mostrar(ESTADO.FIN);
  }

  // ---------- Simulacion ----------

  /** Velocidad en funcion de la distancia, con el turbo si esta activo. */
  get velocidad() {
    const progreso = Math.min(1, this.distancia / 900);
    const base = VELOCIDAD_INICIAL + (VELOCIDAD_MAXIMA - VELOCIDAD_INICIAL) * progreso;
    return this.turbo ? base * FACTOR_TURBO : base;
  }

  /** Unico punto de entrada de la fisica. `dt` es fijo, nunca el delta crudo. */
  actualizar(dt) {
    if (this.estado === ESTADO.MENU) {
      // En el menu el mundo sigue deslizandose de fondo: da vida al menu.
      this.mundo.actualizar(dt, 6);
      this.jugador.actualizar(dt, 6);
      return;
    }

    if (this.estado === ESTADO.PAUSA) return;

    if (this.estado === ESTADO.FIN) {
      // Frenada corta: el mundo se detiene solo, sin tener que congelarlo de golpe.
      this.frenada = Math.max(0, this.frenada - dt * 2.5);
      const velocidad = VELOCIDAD_INICIAL * this.frenada;
      this.mundo.actualizar(dt, velocidad);
      this.pista.actualizar(dt, velocidad);
      this.jugador.actualizar(dt, velocidad);
      return;
    }

    const velocidad = this.velocidad;
    this.distancia += velocidad * dt;

    this.jugador.actualizar(dt, velocidad);
    this.mundo.actualizar(dt, velocidad);
    this.pista.actualizar(dt, velocidad);

    const { choco, monedas } = this.pista.resolver(this.jugador);
    this.monedas += monedas;
    if (choco) {
      this.morir();
      return;
    }

    this.acumuladorHud += dt;
    if (this.acumuladorHud >= UMBRAL_HUD) {
      this.acumuladorHud = 0;
      this.pintarMarcadores();
    }
  }

  pintarMarcadores() {
    this.puntos = Math.floor(this.distancia * METROS_POR_PUNTO) + this.monedas * PUNTOS_POR_MONEDA;
    this.hud.marcar(this.puntos, this.monedas, Math.floor(this.distancia));
  }
}
