/**
 * HUD en DOM sobre el canvas. Se actualiza por evento, nunca por frame:
 * escribir en el DOM 60 veces por segundo es lo mas caro que podria hacer el juego.
 */

export class Hud {
  constructor() {
    this.hud = document.getElementById('hud');
    this.puntos = document.getElementById('puntos');
    this.monedas = document.getElementById('monedas');
    this.distancia = document.getElementById('distancia');

    this.menu = document.getElementById('menu');
    this.pausa = document.getElementById('pausa');
    this.fin = document.getElementById('fin');

    this.puntosFinales = document.getElementById('puntos-finales');
    this.monedasFinales = document.getElementById('monedas-finales');
    this.record = document.getElementById('record');

    this.botones = {
      jugar: document.getElementById('boton-jugar'),
      reiniciar: document.getElementById('boton-reiniciar'),
      seguir: document.getElementById('boton-seguir'),
      pausa: document.getElementById('boton-pausa'),
      menu: document.getElementById('boton-menu'),
      salir: document.getElementById('boton-salir'),
    };

    this.ultimoPuntos = -1;
    this.ultimaDistancia = -1;
    this.ultimasMonedas = -1;
  }

  /** Conecta cada boton con su accion. Las callbacks las define game.js. */
  conectar(acciones) {
    for (const [nombre, fn] of Object.entries(acciones)) {
      this.botones[nombre].addEventListener('click', fn);
    }
  }

  mostrar(nombre) {
    this.menu.classList.toggle('oculto', nombre !== 'menu');
    this.pausa.classList.toggle('oculto', nombre !== 'pausa');
    this.fin.classList.toggle('oculto', nombre !== 'fin');
    this.hud.classList.toggle('oculto', nombre === 'menu');
  }

  /**
   * Marcadores. Compara contra el valor anterior: si no cambio, no se toca el DOM.
   * El texto se escribe con throttling desde game.js, aqui solo se compara.
   */
  marcar(puntos, monedas, distancia) {
    if (puntos !== this.ultimoPuntos) {
      this.puntos.textContent = puntos;
      this.ultimoPuntos = puntos;
    }
    if (distancia !== this.ultimaDistancia) {
      this.distancia.textContent = `${distancia} m`;
      this.ultimaDistancia = distancia;
    }
    if (monedas !== this.ultimasMonedas) {
      this.monedas.textContent = monedas;
      this.ultimasMonedas = monedas;
    }
  }

  resultado(puntos, monedas, esRecord) {
    this.puntosFinales.textContent = puntos;
    this.monedasFinales.textContent = monedas;
    this.record.classList.toggle('oculto', !esRecord);
  }
}
