"use client";

import { useEffect, useState } from "react";

/**
 * REORDENAR UNA LISTA DEL EPK: arrastrando en escritorio, con flechas en todas partes.
 *
 * ============================================================
 * POR QUÉ HAY FLECHAS Y NO SOLO ARRASTRE
 * ============================================================
 *
 * El arrastre nativo de HTML5 —draggable, onDragStart, onDrop— NO FUNCIONA EN TOUCH. No es
 * un detalle de pulido: en un celular no se dispara ningún evento de drag, así que una
 * lista que solo se reordena arrastrando es una lista que en el teléfono no se reordena.
 *
 * Y la audiencia de HOTU es de celular. Entregar solo arrastre habría sido entregar la
 * función para la mitad de la gente, que es exactamente lo que la regla de la transición
 * prohíbe: nadie puede quedar peor de lo que estaba, y "antes no podía reordenar y ahora
 * tampoco, pero en escritorio sí" no es una función terminada.
 *
 * La alternativa era meter una librería de drag con soporte touch. Para dos listas de un
 * perfil es una dependencia grande, y el repo no tiene ninguna: las flechas resuelven el
 * 100% de los casos con cero dependencias, funcionan con teclado, y las lee un lector de
 * pantalla. El arrastre queda como lo que es, una comodidad de escritorio encima.
 *
 * ============================================================
 * SE GUARDA AL SOLTAR, NO EN CADA PASO
 * ============================================================
 *
 * El estado local se mueve enseguida —la lista tiene que responder al dedo o al clic sin
 * esperar la red— y el guardado sale después, con el orden COMPLETO. Si falla, se vuelve al
 * orden que había y se muestra el error: una lista que se ve en un orden y está guardada en
 * otro es peor que una que no se pudo reordenar.
 */

export type ConId = { id: number };

export function usarOrden<T extends ConId>(
  itemsDelServidor: T[],
  guardar: (ids: number[]) => Promise<{ ok: boolean; error?: string }>
) {
  const [items, setItems] = useState(itemsDelServidor);
  const [arrastrando, setArrastrando] = useState<number | null>(null);
  const [guardandoAhora, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Cuando el servidor manda una lista nueva —se agregó o se borró algo y la página se
   * refrescó— el estado local tiene que seguirla. Sin esto, agregar una foto no la muestra
   * hasta recargar a mano, porque el useState inicial ya corrió.
   */
  useEffect(() => {
    setItems(itemsDelServidor);
  }, [itemsDelServidor]);

  const aplicar = async (nuevos: T[], previos: T[]) => {
    setItems(nuevos);
    setError(null);
    setGuardando(true);
    try {
      const r = await guardar(nuevos.map((x) => x.id));
      if (!r.ok) {
        /** VUELVE AL ORDEN ANTERIOR. Dejarlo movido en pantalla mostraría un orden que la
         *  base no tiene. */
        setItems(previos);
        setError(r.error ?? "No se pudo guardar el orden.");
      }
    } finally {
      setGuardando(false);
    }
  };

  /** Mueve el elemento de `desde` a `hasta`, sin tocar el resto. */
  const mover = (desde: number, hasta: number) => {
    if (desde === hasta || hasta < 0 || hasta >= items.length) return;
    const previos = items;
    const nuevos = [...items];
    const [sacado] = nuevos.splice(desde, 1);
    nuevos.splice(hasta, 0, sacado);
    void aplicar(nuevos, previos);
  };

  return {
    items,
    guardandoAhora,
    error,
    /** Para las flechas: funcionan con dedo, con mouse y con teclado. */
    subir: (i: number) => mover(i, i - 1),
    bajar: (i: number) => mover(i, i + 1),
    esPrimero: (i: number) => i === 0,
    esUltimo: (i: number) => i === items.length - 1,
    /** Para el arrastre, que es un extra de escritorio. */
    arrastrando,
    props: (i: number) => ({
      draggable: true,
      onDragStart: () => setArrastrando(i),
      onDragEnd: () => setArrastrando(null),
      onDragOver: (e: React.DragEvent) => {
        /** Sin esto el navegador no permite soltar y el drop nunca se dispara. */
        e.preventDefault();
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        if (arrastrando !== null) mover(arrastrando, i);
        setArrastrando(null);
      },
    }),
  };
}
