/**
 * Raytracing-Engine – öffentliche Schnittstelle (Status: Vorschau).
 *
 * Aufbau:
 *   types.ts       Datentypen (Ray, RayPath, TraceResult …)
 *   csg.ts         Primitive + Intervall-CSG für Strahl-Körper-Schnitte
 *   solids.ts      Datenmodell → verfolgbare Körper (eine Funktion pro Elementfamilie)
 *   refraction.ts  vektorielles Snelliussches Gesetz, Totalreflexion
 *   eyeTracer.ts   sequentielle Verfolgung durch das Modellauge
 *   tracer.ts      Gesamtablauf + Fokusanalyse
 *
 * Später: Dispersion (Abbe-Zahl), Fresnel, Asphären/Torics, Tränenlinse,
 * GRIN-Augenlinse, Spot-Diagramme, Wellenfront (OPD).
 */
export * from './types';
export { traceScene, generateSourceRays, DEFAULT_TRACE_SETTINGS } from './tracer';
export { refract } from './refraction';
