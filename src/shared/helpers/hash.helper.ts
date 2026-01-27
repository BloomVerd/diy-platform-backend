import * as bcrypt from 'bcrypt';

export class HashHelper {
  private static salt = 10;

  public static async encrypt(str: string): Promise<string> {
    const salt = await bcrypt.genSalt(this.salt);
    return await bcrypt.hash(str, salt);
  }

  public static async compare(
    plain: string,
    encrypted: string,
  ): Promise<boolean> {
    return await bcrypt.compare(plain, encrypted);
  }
}
