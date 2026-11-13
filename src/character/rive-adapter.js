import { reportError } from '../core/env.js';

/**
 * RiveCharacterRenderer — conecta o CharacterStateMachine a uma máquina de
 * estados Rive (runtime @rive-app/canvas empacotado localmente pelo app).
 *
 *   new RiveCharacterRenderer({
 *     rive,                       // instância já criada de Rive
 *     stateMachine: 'Chico',
 *     numberInput: 'state',       // input numérico que recebe o código do estado
 *     map: { idle: 0, analyzing: 1, ... },
 *     triggers: { success: 'celebrate' },   // triggers opcionais por estado
 *     idleInput: 'idleEnabled',   // boolean opcional para laços ociosos
 *   })
 *
 * Se a arte Rive não estiver disponível/licenciada, use o SvgCharacterRenderer
 * (o personagem original continua funcionando).
 */
export class RiveCharacterRenderer {
  constructor({ rive, stateMachine, numberInput, map = {}, triggers = {}, idleInput, budget = null } = {}) {
    if (!rive || !stateMachine) throw new Error('RiveCharacterRenderer: rive e stateMachine obrigatórios');
    this.rive = rive;
    this.stateMachine = stateMachine;
    this.numberInput = numberInput;
    this.map = map;
    this.triggers = triggers;
    this.idleInput = idleInput;
    this.budget = budget;
    this._offGame = budget?.on('game', () => this._syncIdle());
    this._offProfile = budget?.on('profile', () => this._syncIdle());
  }

  _inputs() {
    try { return this.rive.stateMachineInputs(this.stateMachine) ?? []; } catch (err) {
      reportError(err, 'rive inputs');
      return [];
    }
  }

  _input(name) { return this._inputs().find((i) => i.name === name); }

  show(state) {
    if (this.numberInput && state in this.map) {
      const input = this._input(this.numberInput);
      if (input) input.value = this.map[state];
    }
    const trigger = this.triggers[state];
    if (trigger) this._input(trigger)?.fire?.();
    this._syncIdle();
  }

  _syncIdle() {
    if (!this.idleInput) return;
    const input = this._input(this.idleInput);
    if (!input) return;
    const mode = this.budget ? (this.budget.gameActive ? 'static' : this.budget.profile.characterIdle) : 'full';
    input.value = mode !== 'static';
    if (mode === 'static' && this.budget?.gameActive) this.rive.pause?.();
    else this.rive.play?.();
  }

  destroy() {
    this._offGame?.();
    this._offProfile?.();
    try { this.rive.cleanup?.(); } catch (err) { reportError(err, 'rive cleanup'); }
  }
}
