import { describe, expect, it } from "vitest";

import {
  passwordByteLength,
  validateDisplayName,
  validateEmail,
  validateLoginPassword,
  validateRegistrationPassword,
  validateUsername,
} from "./form-validation.js";

describe("passwordByteLength", () => {
  it("conta 1 byte por caractere ASCII", () => {
    expect(passwordByteLength("abcdef")).toBe(6);
  });

  it("conta mais de 1 byte por caractere multibyte (acentos/emoji)", () => {
    // "é" ocupa 2 bytes em UTF-8 — password.length (unidades UTF-16) sozinho
    // subestimaria o tamanho real que o backend usa para validar bcrypt (72 bytes).
    expect(passwordByteLength("é")).toBe(2);
    expect("é".length).toBe(1);
    expect(passwordByteLength("é")).not.toBe("é".length);
  });
});

describe("validateEmail", () => {
  it("exige um email não vazio", () => {
    expect(validateEmail("")).toBe("Informe seu email.");
  });

  it("rejeita formatos claramente inválidos", () => {
    expect(validateEmail("sem-arroba")).toBe("Digite um email válido.");
    expect(validateEmail("a@b")).toBe("Digite um email válido.");
  });

  it("rejeita emails maiores que 320 caracteres", () => {
    const longLocalPart = "a".repeat(315);
    expect(validateEmail(`${longLocalPart}@b.com`)).toBe("Digite um email válido.");
  });

  it("aceita um email válido", () => {
    expect(validateEmail("jogador@respawn.gg")).toBeUndefined();
  });
});

describe("validateLoginPassword", () => {
  it("exige uma senha não vazia", () => {
    expect(validateLoginPassword("")).toBe("Informe sua senha.");
  });

  it("rejeita senhas com mais de 72 bytes", () => {
    expect(validateLoginPassword("a".repeat(73))).toBe("A senha deve ter no máximo 72 bytes.");
  });

  it("aceita qualquer senha não vazia dentro do limite de bytes (login não exige força)", () => {
    expect(validateLoginPassword("123")).toBeUndefined();
  });
});

describe("validateUsername", () => {
  it("rejeita usernames curtos demais ou longos demais", () => {
    expect(validateUsername("ab")).toBe("Use entre 3 e 32 caracteres.");
    expect(validateUsername("a".repeat(33))).toBe("Use entre 3 e 32 caracteres.");
  });

  it("rejeita caracteres fora de letras, números, ponto, hífen e sublinhado", () => {
    expect(validateUsername("nome com espaço")).toBe(
      "Use apenas letras, números, ponto, hífen ou sublinhado.",
    );
    expect(validateUsername("nome@invalido")).toBe(
      "Use apenas letras, números, ponto, hífen ou sublinhado.",
    );
  });

  it("aceita um username válido", () => {
    expect(validateUsername("player_one.gg")).toBeUndefined();
  });
});

describe("validateDisplayName", () => {
  it("rejeita nomes de exibição maiores que 64 caracteres", () => {
    expect(validateDisplayName("a".repeat(65))).toBe("Use no máximo 64 caracteres.");
  });

  it("aceita nome de exibição vazio (é opcional) ou dentro do limite", () => {
    expect(validateDisplayName("")).toBeUndefined();
    expect(validateDisplayName("Jogador Respawn")).toBeUndefined();
  });
});

describe("validateRegistrationPassword", () => {
  it("rejeita senhas com menos de 12 caracteres", () => {
    expect(validateRegistrationPassword("Ab1defghi")).toBe("Use pelo menos 12 caracteres.");
  });

  it("exige letra maiúscula, minúscula e número", () => {
    expect(validateRegistrationPassword("apenasminuscula123")).toBe(
      "Inclua letra maiúscula, minúscula e número.",
    );
    expect(validateRegistrationPassword("APENASMAIUSCULA123")).toBe(
      "Inclua letra maiúscula, minúscula e número.",
    );
    expect(validateRegistrationPassword("SemNumeroNenhum")).toBe(
      "Inclua letra maiúscula, minúscula e número.",
    );
  });

  it("rejeita senhas com mais de 72 bytes mesmo cumprindo os outros critérios", () => {
    const tooLong = `Aa1${"a".repeat(70)}`;
    expect(validateRegistrationPassword(tooLong)).toBe("A senha deve ter no máximo 72 bytes.");
  });

  it("aceita uma senha que cumpre todos os critérios", () => {
    expect(validateRegistrationPassword("Respawn-QA-2026!")).toBeUndefined();
  });
});
