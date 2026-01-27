import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';

@Resolver()
export class AuthResolver {
  // Queries
  @Query(() => String)
  loginUser(@Args('email') email: string, @Args('password') password: string) {
    return this.loginUser({ email, password });
  }

  @Mutation(() => String)
  async registerUser(
    @Args('email') email: string,
    @Args('firstName') firstName: string,
    @Args('lastNme') lastName: string,
    @Args('password') password: string,
  ) {
    return this.registerUser(email, firstName, lastName, password);
  }
}

// REGISTER A USER (USERNAME, EMAIL, PASSWORD, FIRSTNAME, LASTNAME)
// lOGIN A USER (USERNAME , PASSOWRD, TOKEN)
// CREATE A CHANNEL. --> Add resolver for channel manageent:  channel.ts
// create a playlist (linked to a channel linked to a user )
//
