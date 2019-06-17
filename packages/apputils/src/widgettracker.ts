// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { InstanceTracker, IRestorable } from '@jupyterlab/coreutils';

import { IDisposable } from '@phosphor/disposable';

import { ISignal, Signal } from '@phosphor/signaling';

import { FocusTracker, Widget } from '@phosphor/widgets';

/**
 * A tracker that tracks widgets.
 *
 * @typeparam T - The type of widget being tracked. Defaults to `Widget`.
 */
export interface IWidgetTracker<T extends Widget = Widget> extends IDisposable {
  /**
   * A signal emitted when a widget is added.
   */
  readonly widgetAdded: ISignal<this, T>;

  /**
   * The current widget is the most recently focused or added widget.
   *
   * #### Notes
   * It is the most recently focused widget, or the most recently added
   * widget if no widget has taken focus.
   */
  readonly currentWidget: T | null;

  /**
   * A signal emitted when the current instance changes.
   *
   * #### Notes
   * If the last instance being tracked is disposed, `null` will be emitted.
   */
  readonly currentChanged: ISignal<this, T | null>;

  /**
   * The number of instances held by the tracker.
   */
  readonly size: number;

  /**
   * A promise that is resolved when the instance tracker has been
   * restored from a serialized state.
   *
   * #### Notes
   * Most client code will not need to use this, since they can wait
   * for the whole application to restore. However, if an extension
   * wants to perform actions during the application restoration, but
   * after the restoration of another instance tracker, they can use
   * this promise.
   */
  readonly restored: Promise<void>;

  /**
   * A signal emitted when a widget is updated.
   */
  readonly widgetUpdated: ISignal<this, T>;

  /**
   * Find the first instance in the tracker that satisfies a filter function.
   *
   * @param - fn The filter function to call on each instance.
   *
   * #### Notes
   * If nothing is found, the value returned is `undefined`.
   */
  find(fn: (obj: T) => boolean): T | undefined;

  /**
   * Iterate through each instance in the tracker.
   *
   * @param fn - The function to call on each instance.
   */
  forEach(fn: (obj: T) => void): void;

  /**
   * Filter the instances in the tracker based on a predicate.
   *
   * @param fn - The function by which to filter.
   */
  filter(fn: (obj: T) => boolean): T[];

  /**
   * Check if this tracker has the specified instance.
   *
   * @param obj - The object whose existence is being checked.
   */
  has(obj: Widget): boolean;

  /**
   * Inject an instance into the instance tracker without the tracker handling
   * its restoration lifecycle.
   *
   * @param obj - The instance to inject into the tracker.
   */
  inject(obj: T): void;
}

/**
 * A class that keeps track of widget instances on an Application shell.
 *
 * @typeparam T - The type of widget being tracked. Defaults to `Widget`.
 *
 * #### Notes
 * The API surface area of this concrete implementation is substantially larger
 * than the widget tracker interface it implements. The interface is intended
 * for export by JupyterLab plugins that create widgets and have clients who may
 * wish to keep track of newly created widgets. This class, however, can be used
 * internally by plugins to restore state as well.
 */
export class WidgetTracker<T extends Widget = Widget>
  implements IWidgetTracker<T>, IRestorable<T> {
  /**
   * Create a new widget tracker.
   *
   * @param options - The instantiation options for a widget tracker.
   */
  constructor(options: WidgetTracker.IOptions) {
    const focus = (this._focusTracker = new FocusTracker());
    const instances = (this._instanceTracker = new InstanceTracker(options));

    this.namespace = options.namespace;

    focus.currentChanged.connect((_, current) => {
      if (current.newValue !== this.currentWidget) {
        instances.current = current.newValue;
      }
    }, this);

    instances.added.connect((_, widget) => {
      this._widgetAdded.emit(widget);
    }, this);

    instances.currentChanged.connect((_, widget) => {
      if (widget === null && focus.currentWidget) {
        instances.current = focus.currentWidget;
        return;
      }
      this.onCurrentChanged(widget);
      this._currentChanged.emit(widget);
    }, this);

    // InstanceTracker#updated
    instances.updated.connect((_, widget) => {
      this._widgetUpdated.emit(widget);
    }, this);
  }

  /**
   * A namespace for all tracked widgets, (e.g., `notebook`).
   */
  readonly namespace: string;

  /**
   * A signal emitted when the current widget changes.
   */
  get currentChanged(): ISignal<this, T | null> {
    return this._currentChanged;
  }

  /**
   * The current widget is the most recently focused or added widget.
   *
   * #### Notes
   * It is the most recently focused widget, or the most recently added
   * widget if no widget has taken focus.
   */
  get currentWidget(): T | null {
    return this._instanceTracker.current || null;
  }

  /**
   * A promise resolved when the instance tracker has been restored.
   */
  get restored(): Promise<void> {
    return this._instanceTracker.restored;
  }

  /**
   * The number of widgets held by the tracker.
   */
  get size(): number {
    return this._instanceTracker.size;
  }

  /**
   * A signal emitted when a widget is added.
   *
   * #### Notes
   * This signal will only fire when a widget is added to the tracker. It will
   * not fire if a widget is injected into the tracker.
   */
  get widgetAdded(): ISignal<this, T> {
    return this._widgetAdded;
  }

  /**
   * A signal emitted when a widget is updated.
   */
  get widgetUpdated(): ISignal<this, T> {
    return this._widgetUpdated;
  }

  /**
   * Add a new widget to the tracker.
   *
   * @param widget - The widget being added.
   *
   * #### Notes
   * When widget is added its state is saved with the data connector.
   * This function returns a promise that is resolved when that saving
   * is completed. However, the instance is added to the in-memory tracker
   * synchronously, and is available to use before the promise is resolved.
   */
  async add(widget: T): Promise<void> {
    this._focusTracker.add(widget);
    await this._instanceTracker.add(widget);
    this._instanceTracker.current = widget;
  }

  /**
   * Test whether the tracker is disposed.
   */
  get isDisposed(): boolean {
    return this._isDisposed;
  }

  /**
   * Dispose of the resources held by the tracker.
   */
  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this._isDisposed = true;
    this._instanceTracker.dispose();
    this._focusTracker.dispose();
    Signal.clearData(this);
  }

  /**
   * Find the first widget in the tracker that satisfies a filter function.
   *
   * @param - fn The filter function to call on each widget.
   *
   * #### Notes
   * If no widget is found, the value returned is `undefined`.
   */
  find(fn: (widget: T) => boolean): T | undefined {
    return this._instanceTracker.find(fn);
  }

  /**
   * Iterate through each widget in the tracker.
   *
   * @param fn - The function to call on each widget.
   */
  forEach(fn: (widget: T) => void): void {
    return this._instanceTracker.forEach(fn);
  }

  /**
   * Filter the widgets in the tracker based on a predicate.
   *
   * @param fn - The function by which to filter.
   */
  filter(fn: (widget: T) => boolean): T[] {
    return this._instanceTracker.filter(fn);
  }

  /**
   * Inject a foreign widget into the instance tracker.
   *
   * @param widget - The widget to inject into the tracker.
   *
   * #### Notes
   * Any widgets injected into an instance tracker will not have their state
   * saved by the tracker. The primary use case for widget injection is for a
   * plugin that offers a sub-class of an extant plugin to have its instances
   * share the same commands as the parent plugin (since most relevant commands
   * will use the `currentWidget` of the parent plugin's instance tracker). In
   * this situation, the sub-class plugin may well have its own instance tracker
   * for layout and state restoration in addition to injecting its widgets into
   * the parent plugin's instance tracker.
   */
  inject(widget: T): Promise<void> {
    return this._instanceTracker.inject(widget);
  }

  /**
   * Check if this tracker has the specified widget.
   *
   * @param widget - The widget whose existence is being checked.
   */
  has(widget: Widget): boolean {
    return this._instanceTracker.has(widget as any);
  }

  /**
   * Restore the widgets in this tracker's namespace.
   *
   * @param options - The configuration options that describe restoration.
   *
   * @returns A promise that resolves when restoration has completed.
   *
   * #### Notes
   * This function should almost never be invoked by client code. Its primary
   * use case is to be invoked by a layout restorer plugin that handles
   * multiple instance trackers and, when ready, asks them each to restore their
   * respective widgets.
   */
  async restore(options: IRestorable.IOptions<T>): Promise<any> {
    return this._instanceTracker.restore(options);
  }

  /**
   * Save the restore data for a given widget.
   *
   * @param widget - The widget being saved.
   */
  async save(widget: T): Promise<void> {
    return this._instanceTracker.save(widget);
  }

  /**
   * Handle the current change event.
   *
   * #### Notes
   * The default implementation is a no-op.
   */
  protected onCurrentChanged(value: T | null): void {
    /* no-op */
  }

  private _currentChanged = new Signal<this, T>(this);
  private _focusTracker: FocusTracker<T>;
  private _instanceTracker: InstanceTracker<T>;
  private _isDisposed = false;
  private _widgetAdded = new Signal<this, T>(this);
  private _widgetUpdated = new Signal<this, T>(this);
}

/**
 * A namespace for `WidgetTracker` statics.
 */
export namespace WidgetTracker {
  /**
   * The instantiation options for an instance tracker.
   */
  export interface IOptions {
    /**
     * A namespace for all tracked widgets, (e.g., `notebook`).
     */
    namespace: string;
  }
}
