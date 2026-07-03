const bcrypt = require('bcrypt');
const userRepository = require('../repositories/UserRepository');

class AuthService {
  async register(name, email, password, role = 'user') {
    const existingUser = await userRepository.findByEmail(email);
    if (existingUser) {
      throw new Error('Email is already registered');
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    return await userRepository.createUser(name, email, passwordHash, role);
  }

  async login(email, password) {
    const user = await userRepository.findByEmail(email);
    if (!user) {
      throw new Error('Invalid email or password');
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      throw new Error('Invalid email or password');
    }

    return user;
  }
}

module.exports = new AuthService();
