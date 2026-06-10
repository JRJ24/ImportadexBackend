import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 12;

const hashPassword = async(password: string) => {
    return await bcrypt.hash(password, SALT_ROUNDS);
}

export {hashPassword};
