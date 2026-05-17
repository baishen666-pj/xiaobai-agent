export class LazyLoader<T> {
  private promise: Promise<T> | null = null;
  private loader: () => Promise<T>;

  constructor(loader: () => Promise<T>) {
    this.loader = loader;
  }

  get(): Promise<T> {
    if (!this.promise) {
      this.promise = this.loader();
    }
    return this.promise;
  }

  reset(): void {
    this.promise = null;
  }
}
