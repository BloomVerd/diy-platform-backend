import { ObjectType, Field, ID, registerEnumType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  BeforeInsert,
} from 'typeorm';

export enum UserRole {
  ADMIN = 'ADMIN',
  STAFF = 'STAFF',
  USER = 'USER',
  CREATOR = 'CREATOR',
}

registerEnumType(UserRole, { name: 'UserRole' });

@ObjectType()
@Entity('users')
export class User {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field()
  @Column()
  firstName: string;

  @Field()
  @Column()
  lastName: string;

  @Field()
  @Column({ unique: true })
  email: string;

  @Column()
  password: string;

  @Field(() => String, { nullable: true })
  @Column({ nullable: true, unique: true })
  phone?: string;

  @Field(() => UserRole)
  @Column({ type: 'enum', enum: UserRole, default: UserRole.USER })
  role: UserRole;

  @Field()
  @Column({ default: true })
  isActive: boolean;

  @Field()
  @Column({ default: false })
  isVerified: boolean;

  @Field(() => Date, { nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  lastLoginAt?: Date;

  @Column({ nullable: true })
  refreshToken?: string;

  @Field()
  @CreateDateColumn()
  createdAt: Date;

  @Field()
  @UpdateDateColumn()
  updatedAt: Date;

  @BeforeInsert()
  lowercaseEmail() {
    this.email = this.email.toLowerCase();
  }
}
