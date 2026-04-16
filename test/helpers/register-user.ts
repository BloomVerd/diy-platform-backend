import { User } from '../../src/user/entities/user.entity';

export const registerUser = async ({
  email,
  firstName,
  lastName,
  password,
}: {
  email: string;
  firstName: string;
  lastName: string;
  password: string;
}) => {
  const user = new User();
  user.email = email;
  user.firstName = firstName;
  user.lastName = lastName;
  user.password = password;
  return user;
};
