package com.napoleon.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

/** Query parameters of GET /api/search. */
public record SearchRequest(
        @NotBlank(message = "q must not be blank") @Size(max = 1000) String q,
        @Min(1) @Max(100) Integer limit,
        @Positive Long mediaId) {}
