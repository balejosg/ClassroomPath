import { describe, it, expect } from 'vitest';
import { validateEmail, validatePassword } from '../validation';

describe('Validation Utils', () => {
  describe('validateEmail', () => {
    it('should return true for valid emails', () => {
      expect(validateEmail('test@example.com')).toBe(true);
      expect(validateEmail('user.name@domain.co.uk')).toBe(true);
    });

    it('should return false for invalid emails', () => {
      expect(validateEmail('test@example')).toBe(false);
      expect(validateEmail('test.com')).toBe(false);
      expect(validateEmail('@domain.com')).toBe(false);
      expect(validateEmail('test @domain.com')).toBe(false);
    });
  });

  describe('validatePassword', () => {
    it('should validate length >= 8', () => {
      expect(validatePassword('Ab1').length).toBe(false);
      expect(validatePassword('Ab1cdefg').length).toBe(true);
    });

    it('should check for uppercase letters', () => {
      expect(validatePassword('abcdefg1').hasUpper).toBe(false);
      expect(validatePassword('Abcdefg1').hasUpper).toBe(true);
    });

    it('should check for lowercase letters', () => {
      expect(validatePassword('ABCDEFG1').hasLower).toBe(false);
      expect(validatePassword('Abcdefg1').hasLower).toBe(true);
    });

    it('should check for digits', () => {
      expect(validatePassword('Abcdefgh').hasDigit).toBe(false);
      expect(validatePassword('Abcdefg1').hasDigit).toBe(true);
    });

    it('should be valid only if all conditions are met', () => {
      expect(validatePassword('Abcdefg1').isValid).toBe(true);
      expect(validatePassword('abcdefg1').isValid).toBe(false); // missing upper
      expect(validatePassword('ABCDEFG1').isValid).toBe(false); // missing lower
      expect(validatePassword('Abcdefgh').isValid).toBe(false); // missing digit
      expect(validatePassword('Ab1').isValid).toBe(false); // missing length
    });
  });
});
