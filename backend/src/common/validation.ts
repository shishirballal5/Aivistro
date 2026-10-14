import { ValidateIf } from 'class-validator';

/**
 * Drop-in replacement for class-validator's `IsOptional`.
 *
 * The original skips validation for BOTH `undefined` and `null`, so `{"price": null}` slips past every other rule on that
 * property and then hits a NOT NULL column (a 500). This one only skips a property that is genuinely ABSENT; an explicit
 * `null` is validated like any other value (and rejected by `@IsInt()`, `@IsString()` etc.).
 */
export const IsOptional = () => ValidateIf((_object, value) => value !== undefined);
