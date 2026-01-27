import { User } from 'src/user/resources/user.entity';

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
  user.name = `${firstName} ${lastName}`;
  user.password = password; // In a real scenario, make sure to hash the password before saving
  return user;
};
