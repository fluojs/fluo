export class HelloService {
  greet(name: string): { message: string } {
    return { message: `Hello, ${name}!` };
  }
}
