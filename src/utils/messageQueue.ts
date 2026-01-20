export class MessageQueue<T> {
  private inbox: T[] = [];
  private locked = false;
  private async lock() {
    while (this.locked === true) {
      await Promise.resolve();
    }
    this.locked = true;
  }
  private unlock() {
    this.locked = false;
  }
  public async put(data: T) {
    await this.lock();
    this.inbox.push(data);
    this.unlock();
  }

  public async get() {
    let a: T | undefined = undefined;
    await this.lock();
    if (this.inbox.length > 0) {
      a = this.inbox.shift();
    }
    this.unlock();
    return a;
  }
}
