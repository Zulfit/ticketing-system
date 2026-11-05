import { IsString, MinLength } from 'class-validator';

export class DepartmentNameDto {
  @IsString()
  @MinLength(1)
  name!: string;
}
