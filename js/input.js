/**
 * Entrada -> acciones. Solo teclas de flecha direccionales, mas swipe en tactil.
 * No conoce el juego: emite acciones y quien las escucha decide que hacer.
 */

const TECLAS = {
  ArrowUp: 'salto',
  ArrowDown: 'deslizar',
  ArrowLeft: 'carril',
  ArrowRight: 'carril',
  Space: 'turbo',
};

const UMBRAL_SWIPE = 28;
// Mantener pulsado este tiempo en la mitad superior ya no cuenta como tap:
// dispara el turbo. Es lo que separa "he tocado para saltar" de "lo estoy
// manteniendo para acelerar", que en un movil son gestos indistinguibles si no
// se fija un umbral.
const UMBRAL_MANTENIMIENTO = 220;
// Ventana para dos taps seguidos y contarlos como doble tap.
const UMBRAL_DOBLE_TAP = 280;
// Caida al pasar por una viga a velocidad maxima: ~60 ms de cruce, pero hace
// falta margen para llegar agachado. 100 ms era insuficiente.
const DURACION_GESTO = 300;

export class Entrada {
  constructor(elemento) {
    this.acciones = new Map();
    this.origenX = 0;
    this.origenY = 0;
    this.activo = false;

    // Estado del gesto tactil en curso.
    this.temporizadorMantenimiento = 0;
    this.mantenido = null;
    this.ultimoTap = 0;
    this.ultimoTapX = 0;
    this.ultimoTapY = 0;
    this.deslizadorTemporal = false;

    this.alPulsar = this.alPulsar.bind(this);
    this.alSoltarTecla = this.alSoltarTecla.bind(this);
    this.alSoltar = this.alSoltar.bind(this);

    window.addEventListener('keydown', this.alPulsar, { passive: false });
    window.addEventListener('keyup', this.alSoltarTecla, { passive: false });
    elemento.addEventListener('pointerdown', this.alPulsar, { passive: false });
    elemento.addEventListener('pointerup', this.alSoltar);
    elemento.addEventListener('pointercancel', this.alSoltar);
    // Si la pestana pierde el foco con la tecla pulsada, el keyup nunca llega:
    // sin esto el jugador se quedaria deslizando para siempre.
    window.addEventListener('blur', () => {
      // Solo lo que este activo. Emitir 'soltar-desliz' siempre metia un
      // soltado espurio en el registro de acciones de cada cambio de pestana.
      if (this.mantenido === 'deslizar') this.emitir('soltar-desliz');
      if (this.mantenido === 'turbo') this.emitir('soltar-turbo');
      if (this.deslizadorTemporal) {
        clearTimeout(this.temporizadorDesliz);
        this.emitir('soltar-desliz');
        this.deslizadorTemporal = false;
      }
      // Un turbo disparado por mantener el dedo se queda activo sin este
      // reset: al volver de background el juego seguiria a 2.5x sin tocar nada.
      this.activo = false;
      this.mantenido = null;
      clearTimeout(this.temporizadorMantenimiento);
    });
  }

  /** Registra un escucha. Devuelve la funcion para dar de baja. */
  on(accion, fn) {
    if (!this.acciones.has(accion)) this.acciones.set(accion, []);
    this.acciones.get(accion).push(fn);
    return () => this.acciones.get(accion).splice(this.acciones.get(accion).indexOf(fn), 1);
  }

  emitir(accion, dato) {
    const escuchas = this.acciones.get(accion);
    if (!escuchas) return;
    for (const fn of escuchas) fn(dato);
  }

  alPulsar(evento) {
    if (evento.type === 'pointerdown') {
      // Ignorar gestos con mas de un dedo: el turbo es "mantener arriba", y un
      // segundo dedo apoyado haria que el primero dejara de ser una pulsacion
      // simple. Solo se sigue el primer puntero.
      if (this.activo) return;
      this.activo = true;
      this.origenX = evento.clientX;
      this.origenY = evento.clientY;
      this.puntero = evento.pointerId;
      evento.preventDefault();

      // Mantener en la mitad superior -> turbo, con retardo para no robbingar
      // el salto de un tap normal (que dura menos de UMBRAL_MANTENIMIENTO).
      if (this.origenY < window.innerHeight / 2) {
        this.temporizadorMantenimiento = setTimeout(() => {
          this.mantenido = 'turbo';
          this.emitir('turbo');
        }, UMBRAL_MANTENIMIENTO);
      }
      return;
    }

    if (evento.code === 'Escape' || evento.code === 'KeyP') {
      evento.preventDefault();
      this.emitir('pausa');
      return;
    }

    const accion = TECLAS[evento.code];
    if (!accion) return;

    evento.preventDefault();
    if (evento.repeat) return;

    if (accion === 'carril') {
      this.emitir('carril', evento.code === 'ArrowLeft' ? -1 : 1);
    } else {
      this.emitir(accion);
    }
  }

  alSoltarTecla(evento) {
    if (evento.code === 'ArrowDown') {
      evento.preventDefault();
      this.emitir('soltar-desliz');
      return;
    }
    if (evento.code === 'Space') {
      evento.preventDefault();
      this.emitir('soltar-turbo');
    }
  }

  alSoltar(evento) {
    if (!this.activo) return;
    if (evento.type === 'pointerup' && evento.pointerId !== this.puntero) return;

    this.activo = false;
    clearTimeout(this.temporizadorMantenimiento);
    this.temporizadorMantenimiento = 0;

    // Si hubo turbo por mantenimiento, no se procesa gesto: ya se emitio.
    if (this.mantenido === 'turbo') {
      this.mantenido = null;
      this.emitir('soltar-turbo');
      return;
    }
    this.mantenido = null;

    // Cancelar (el sistema se queda con el dedo, o llega otro puntero): no se
    // interpreta nada, pero se sueltan los estados por si estaban activos.
    if (evento.type === 'pointercancel') return;

    const dx = evento.clientX - this.origenX;
    const dy = evento.clientY - this.origenY;

    // Un tap en la mitad superior de la pantalla tambien salta: es lo que
    // espera un jugador en movil, donde no hay teclado.
    if (Math.abs(dx) < UMBRAL_SWIPE && Math.abs(dy) < UMBRAL_SWIPE) {
      if (this.origenY >= window.innerHeight / 2) return;

      const ahora = evento.timeStamp || performance.now();
      const cerca = Math.abs(evento.clientX - this.ultimoTapX) < UMBRAL_SWIPE * 2;
      const dobleTap = cerca && ahora - this.ultimoTap < UMBRAL_DOBLE_TAP;

      // El par se consume: si no se limpiara, el siguiente tap volveria a
      // emparejarse con el anterior y todos los taps rapidos cuenta como dobles.
      this.ultimoTap = dobleTap ? 0 : ahora;
      this.ultimoTapX = evento.clientX;
      this.ultimoTapY = evento.clientY;

      // El doble tap tambien salta: es la misma accion, pedido por si se
      // prefiere el gesto de dos toques al de uno.
      this.emitir('salto', { dobleTap });
      return;
    }

    if (Math.abs(dy) > Math.abs(dx)) {
      if (dy < 0) {
        this.emitir('salto');
      } else {
        // En tactil el dedo ya esta lifted cuando se detecta el gesto, asi que no
        // hay keyup que esperar: se mantiene el tiempo de un desliz y se suelta.
        this.emitir('deslizar');
        clearTimeout(this.temporizadorDesliz);
        this.deslizadorTemporal = true;
        this.temporizadorDesliz = setTimeout(() => {
          this.deslizadorTemporal = false;
          this.emitir('soltar-desliz');
        }, DURACION_GESTO);
      }
    } else {
      this.emitir('carril', dx < 0 ? -1 : 1);
    }
  }
}
