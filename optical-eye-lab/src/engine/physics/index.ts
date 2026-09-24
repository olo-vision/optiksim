/**
 * Physik-Engine – öffentliche Schnittstelle.
 *
 * Phase 1: paraxiale Formeln (Flächenbrechwert, dicke Linse, Scheitelbrechwert,
 * Prismenablenkung, Kenngrößen des Modellauges).
 *
 * Später vorgesehen (als eigene Dateien in diesem Ordner):
 *   - ametropia.ts     sphärische/astigmatische Fehlsichtigkeit, Presbyopie
 *   - correction.ts    Korrektionswirkung, HSA, effektive Brechkraft
 *   - tearLens.ts      Tränenlinse zwischen Kontaktlinse und Hornhaut
 *   - aberrations.ts   Zernike / Wellenfront
 */
export * from './formulas';
export * from './paraxial';
export * from './eyeOptics';
export * from './elementOptics';
